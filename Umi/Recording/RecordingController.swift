import AVFoundation
import Observation
import ScreenCaptureKit

/// Drives a recording session: permissions, countdown, camera bubble, tracks and saving.
@Observable
final class RecordingController {
    enum Phase: Equatable {
        case idle, countingDown, recording, paused, finishing
    }

    private(set) var phase: Phase = .idle
    var settings = RecordingSettings()
    private(set) var displays: [SCDisplay] = []
    private(set) var windows: [SCWindow] = []
    private(set) var lastError: String?
    private(set) var lastFinishedURL: URL?

    private let camera = CameraBubbleController()
    private let countdown = CountdownOverlay()
    private var startTask: Task<Void, Never>?
    private var session: Session?

    /// Everything that exists only while a recording is running.
    private struct Session {
        let bundle: URL
        let clock: RecordingClock
        let screen: ScreenCapture
        let screenWriter: MovieWriter
        let cursor: CursorRecorder
        let cameraOn: Bool
        let project: RecordingProject
    }

    var elapsed: TimeInterval { session?.clock.elapsed.seconds ?? 0 }

    // MARK: Sources

    func refreshSources() async {
        guard phase == .idle else { return }
        if settings.showCamera { camera.show() }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            displays = content.displays
            windows = content.windows.filter { window in
                window.isOnScreen
                    && window.windowLayer == 0
                    && window.frame.width > 120 && window.frame.height > 80
                    && window.owningApplication?.processID != ProcessInfo.processInfo.processIdentifier
            }
            if settings.displayID == nil || !displays.contains(where: { $0.displayID == settings.displayID }) {
                settings.displayID = displays.first(where: { $0.displayID == CGMainDisplayID() })?.displayID ?? displays.first?.displayID
            }
            if settings.windowID == nil || !windows.contains(where: { $0.windowID == settings.windowID }) {
                settings.windowID = windows.first?.windowID
            }
            if lastError == RecorderError.screenPermissionDenied.errorDescription { lastError = nil }
        } catch {
            lastError = RecorderError.screenPermissionDenied.errorDescription
        }
    }

    func setCameraPreview(_ on: Bool) {
        if on { camera.show() } else { camera.hide() }
    }

    // MARK: Control

    func start() {
        guard phase == .idle else { return }
        lastError = nil
        startTask = Task { await runStart() }
    }

    func pause() {
        guard phase == .recording, let session else { return }
        session.clock.pause()
        phase = .paused
    }

    func resume() {
        guard phase == .paused, let session else { return }
        session.clock.resume()
        phase = .recording
    }

    func stop() {
        guard phase == .recording || phase == .paused, let session else { return }
        phase = .finishing
        let end = session.clock.stop()
        Task {
            let cursorData = session.cursor.stop()
            await session.screen.stop()
            await session.screenWriter.finish(at: end)
            let hasCamera = session.cameraOn ? await camera.session.finishRecording(at: end) : false

            do {
                var project = session.project
                project.duration = end.seconds
                if !hasCamera { project.camera = nil }
                try ProjectStore.write(cursorData, to: session.bundle.appendingPathComponent(RecordingProject.cursorFile))
                try ProjectStore.write(project, to: session.bundle.appendingPathComponent(RecordingProject.fileName))
                lastFinishedURL = session.bundle
            } catch {
                lastError = "Couldn't save the recording: \(error.localizedDescription)"
            }
            finish()
        }
    }

    func cancel() {
        startTask?.cancel()
        countdown.dismiss()
        guard let session else { finish(); return }
        _ = session.clock.stop()
        _ = session.cursor.stop()
        session.screenWriter.cancel()
        camera.session.cancelRecording()
        Task {
            await session.screen.stop()
            try? FileManager.default.removeItem(at: session.bundle)
            finish()
        }
    }

    /// Throws the current take away and starts a new one with the same settings.
    func restart() {
        guard phase == .recording || phase == .paused, let session else { return }
        _ = session.clock.stop()
        _ = session.cursor.stop()
        session.screenWriter.cancel()
        camera.session.cancelRecording()
        self.session = nil
        phase = .finishing
        Task {
            await session.screen.stop()
            try? FileManager.default.removeItem(at: session.bundle)
            phase = .idle
            start()
        }
    }

    // MARK: Private

    private func runStart() async {
        guard await ensurePermissions() else { return }
        await refreshSources()

        if settings.countdown {
            phase = .countingDown
            let completed = await countdown.run(seconds: 3)
            guard completed, !Task.isCancelled else { finish(); return }
        }

        do {
            session = try await makeSession()
            guard let session else { return }
            try await session.screen.start()
            session.clock.start()
            session.cursor.start()
            if session.cameraOn {
                camera.session.startRecording(to: session.bundle.appendingPathComponent(RecordingProject.cameraFile), clock: session.clock)
            }
            phase = .recording
        } catch {
            if let session { try? FileManager.default.removeItem(at: session.bundle) }
            session = nil
            lastError = error.localizedDescription
            finish()
        }
    }

    private func makeSession() async throws -> Session {
        let (filter, captureRect) = try await makeFilter()
        let fps = 60
        let config = ScreenCapture.makeConfiguration(for: filter, fps: fps, systemAudio: settings.captureSystemAudio, microphone: settings.captureMicrophone)

        var audio: [MovieWriter.Audio] = []
        var tracks = ScreenCapture.AudioTracks()
        if settings.captureSystemAudio { tracks.system = audio.count; audio.append(.init(channels: 2)) }
        if settings.captureMicrophone { tracks.microphone = audio.count; audio.append(.init(channels: 1)) }

        let bundle = try RecordingsLibrary.newRecordingURL()
        try FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)
        let clock = RecordingClock()
        let writer = try MovieWriter(
            url: bundle.appendingPathComponent(RecordingProject.screenFile),
            video: .init(width: config.width, height: config.height, fps: fps),
            audio: audio
        )
        let screen = try ScreenCapture(filter: filter, configuration: config, writer: writer, tracks: tracks, clock: clock)
        screen.onUnexpectedStop = { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }

        let cameraOn = settings.showCamera && AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        let project = RecordingProject(
            createdAt: Date(),
            duration: 0,
            screen: .init(pixelWidth: config.width, pixelHeight: config.height, captureRect: captureRect, fps: fps),
            camera: cameraOn ? .init(bubbleCenter: camera.normalizedCenter(in: captureRect)) : nil,
            audio: .init(systemTrack: tracks.system, microphoneTrack: tracks.microphone)
        )
        return Session(
            bundle: bundle, clock: clock, screen: screen, screenWriter: writer,
            cursor: CursorRecorder(clock: clock, captureRect: captureRect),
            cameraOn: cameraOn, project: project
        )
    }

    private func ensurePermissions() async -> Bool {
        if !CGPreflightScreenCaptureAccess() {
            CGRequestScreenCaptureAccess()
            lastError = RecorderError.screenPermissionDenied.errorDescription
            return false
        }
        if settings.captureMicrophone, await !AVCaptureDevice.requestAccess(for: .audio) {
            settings.captureMicrophone = false
            lastError = "Microphone access is off, recording without your voice. You can enable it in System Settings › Privacy & Security › Microphone."
        }
        return true
    }

    /// The content filter plus the captured area in global screen points.
    private func makeFilter() async throws -> (SCContentFilter, CGRect) {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        switch settings.mode {
        case .display:
            guard let display = content.displays.first(where: { $0.displayID == settings.displayID }) else {
                throw RecorderError.noSource
            }
            // Leave out all of Umi's own windows: menu, countdown and the camera bubble
            // (the camera has its own track and is composited by the editor).
            let pid = ProcessInfo.processInfo.processIdentifier
            let own = content.windows.filter { $0.owningApplication?.processID == pid }
            return (SCContentFilter(display: display, excludingWindows: own), CGDisplayBounds(display.displayID))
        case .window:
            guard let window = content.windows.first(where: { $0.windowID == settings.windowID }) else {
                throw RecorderError.noSource
            }
            return (SCContentFilter(desktopIndependentWindow: window), window.frame)
        }
    }

    private func finish() {
        camera.hide()
        session = nil
        phase = .idle
        startTask = nil
    }
}

enum RecorderError: LocalizedError {
    case noSource
    case screenPermissionDenied

    var errorDescription: String? {
        switch self {
        case .noSource: "Choose a screen or window to record."
        case .screenPermissionDenied: "Umi needs Screen Recording permission. Enable it in System Settings › Privacy & Security › Screen & System Audio Recording, then try again."
        }
    }
}
