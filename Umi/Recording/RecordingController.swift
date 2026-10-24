import AppKit
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
    /// False until macOS grants Screen Recording. The launcher shows a permission card
    /// instead of letting every capture call trigger the system prompt again.
    private(set) var hasScreenPermission = CGPreflightScreenCaptureAccess()
    /// macOS only shows its own prompt once per launch; after that we point to Settings.
    private var askedForScreenPermission = false

    private let camera = CameraBubbleController()
    private let countdown = CountdownOverlay()
    private let controlBar = ControlBarController()
    private let hotKeys = HotKeys()
    private var launcherOpen = false
    /// Set by the status bar; opens or closes the launcher (⌥⇧U).
    var onOpenLauncher: () -> Void = {}
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

    init() {
        // The bubble's × turns the camera off for this setup.
        camera.onHide = { [weak self] in
            self?.settings.showCamera = false
            self?.setCameraPreview(false)
        }
        hotKeys.register(.startStop) { [weak self] in
            guard let self else { return }
            switch phase {
            case .idle: start()
            case .recording, .paused: stop()
            case .countingDown: cancel()
            case .finishing: break
            }
        }
        hotKeys.register(.pauseResume) { [weak self] in
            guard let self else { return }
            if phase == .recording { pause() } else if phase == .paused { resume() }
        }
        hotKeys.register(.screenshot) { [weak self] in
            guard self?.phase == .idle else { return }
            ScreenshotEditor.captureArea()
        }
        hotKeys.register(.launcher) { [weak self] in
            self?.onOpenLauncher()
        }
        hotKeys.register(.cancel) { [weak self] in
            guard let self, phase != .idle, phase != .finishing else { return }
            cancel()
        }
    }

    // MARK: Launcher

    /// The camera bubble is visible while the launcher is open (to frame yourself)
    /// and during a recording, never otherwise.
    func launcherDidOpen() {
        launcherOpen = true
        if phase == .idle, settings.showCamera { camera.show() }
    }

    var cameraBubbleFrame: CGRect? { camera.visibleFrame }

    // MARK: Camera settings

    var cameraBubble: CameraBubbleModel { camera.model }
    func setCameraSize(_ size: CameraBubbleStyle.Size) { camera.setSize(size) }
    func setCameraShape(_ shape: EditSettings.Camera.Shape) { camera.setShape(shape) }
    func toggleCameraMirror() { camera.toggleMirror() }

    func selectCamera(_ id: String?) {
        settings.cameraID = id
        camera.session.selectDevice(id)
    }

    var selectedCamera: AVCaptureDevice? {
        settings.cameraID.flatMap(AVCaptureDevice.init(uniqueID:)) ?? AVCaptureDevice.default(for: .video)
    }

    /// Center Stage keeps you framed as you move. Apps may switch it in "cooperative" mode.
    var supportsCenterStage: Bool { selectedCamera?.activeFormat.isCenterStageSupported ?? false }
    var centerStageEnabled: Bool {
        get { access(keyPath: \.centerStageEnabled); return AVCaptureDevice.isCenterStageEnabled }
        set {
            withMutation(keyPath: \.centerStageEnabled) {
                AVCaptureDevice.centerStageControlMode = .cooperative
                AVCaptureDevice.isCenterStageEnabled = newValue
            }
        }
    }

    /// Whether a screen point (AppKit global coordinates) is on the camera bubble.
    func cameraBubbleContains(_ point: CGPoint) -> Bool {
        camera.visibleFrame?.contains(point) ?? false
    }

    func launcherDidClose() {
        launcherOpen = false
        if phase == .idle { camera.hide() }
    }

    // MARK: Sources

    func refreshSources() async {
        guard phase == .idle else { return }
        // Any ScreenCaptureKit call without permission pops the system prompt, so don't
        // touch it until access is granted.
        hasScreenPermission = CGPreflightScreenCaptureAccess()
        guard hasScreenPermission else { return }
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
            lastError = error.localizedDescription
        }
    }

    /// Shows macOS's prompt the first time; afterwards opens the Settings pane directly.
    func requestScreenPermission() {
        if !askedForScreenPermission {
            askedForScreenPermission = true
            if CGRequestScreenCaptureAccess() { hasScreenPermission = true; return }
        }
        openScreenRecordingSettings()
    }

    func openScreenRecordingSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    /// A newly granted Screen Recording permission only applies after a relaunch.
    func relaunch() {
        let url = Bundle.main.bundleURL
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in
            Task { @MainActor in NSApp.terminate(nil) }
        }
    }

    func setCameraPreview(_ on: Bool) {
        if session?.cameraOn == true {
            // Mid-recording: only the bubble goes away, camera.mov keeps running.
            if on { camera.showPanel() } else { camera.hidePanel() }
        } else if on {
            if launcherOpen || phase != .idle { camera.show() }
        } else {
            camera.hide()
        }
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
        let bubble = camera.editCamera(in: session.project.screen.captureRect)
        Task {
            let cursorData = session.cursor.stop()
            await session.screen.stop()
            await session.screenWriter.finish(at: end)
            let hasCamera = session.cameraOn ? await camera.session.finishRecording(at: end) : false

            do {
                var project = session.project
                project.duration = end.seconds
                if hasCamera { project.camera?.bubble = bubble } else { project.camera = nil }
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

        if settings.showCamera { camera.show() }
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
            controlBar.show(recorder: self)
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
        let (filter, captureRect, sourceRect) = try await makeFilter()
        // Camera only keeps a tiny, hidden screen track (it carries the audio).
        let cameraOnly = settings.mode == .cameraOnly
        let fps = cameraOnly ? 15 : settings.quality.fps
        let config = ScreenCapture.makeConfiguration(for: filter, sourceRect: sourceRect,
                                                     maxHeight: cameraOnly ? 360 : settings.quality.resolution.maxHeight, fps: fps,
                                                     systemAudio: settings.captureSystemAudio, microphone: settings.captureMicrophone,
                                                     microphoneID: settings.microphoneID)

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
            audio: .init(systemTrack: tracks.system, microphoneTrack: tracks.microphone),
            cameraOnly: cameraOnly ? true : nil
        )
        return Session(
            bundle: bundle, clock: clock, screen: screen, screenWriter: writer,
            cursor: CursorRecorder(clock: clock, captureRect: captureRect),
            cameraOn: cameraOn, project: project
        )
    }

    private func ensurePermissions() async -> Bool {
        hasScreenPermission = CGPreflightScreenCaptureAccess()
        if !hasScreenPermission {
            requestScreenPermission()
            return false
        }
        if settings.captureMicrophone, await !AVCaptureDevice.requestAccess(for: .audio) {
            settings.captureMicrophone = false
            lastError = "Microphone access is off, recording without your voice. You can enable it in System Settings › Privacy & Security › Microphone."
        }
        return true
    }

    /// The content filter, the captured area in global screen points, and for an area
    /// recording the part of the display to capture (display points).
    private func makeFilter() async throws -> (SCContentFilter, CGRect, CGRect?) {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let pid = ProcessInfo.processInfo.processIdentifier
        let own = content.applications.filter { $0.processID == pid }
        switch settings.mode {
        case .area:
            guard let area = settings.areaRect,
                  let display = content.displays.first(where: { CGDisplayBounds($0.displayID).intersects(area) }) else { throw RecorderError.noSource }
            let bounds = CGDisplayBounds(display.displayID)
            let clipped = area.intersection(bounds)
            let local = CGRect(x: clipped.minX - bounds.minX, y: clipped.minY - bounds.minY, width: clipped.width, height: clipped.height)
            return (SCContentFilter(display: display, excludingApplications: own, exceptingWindows: []), clipped, local)
        case .cameraOnly:
            guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { throw RecorderError.noSource }
            return (SCContentFilter(display: display, excludingApplications: own, exceptingWindows: []), CGDisplayBounds(display.displayID), nil)
        case .display:
            guard let display = content.displays.first(where: { $0.displayID == settings.displayID }) else {
                throw RecorderError.noSource
            }
            // Leave out all of Umi's own windows: menu, countdown and the camera bubble
            // (the camera has its own track and is composited by the editor). Excluding the
            // app rather than its current windows also covers windows shown mid-recording,
            // like the control bar or a re-opened bubble.
            return (SCContentFilter(display: display, excludingApplications: own, exceptingWindows: []), CGDisplayBounds(display.displayID), nil)
        case .window:
            guard let window = content.windows.first(where: { $0.windowID == settings.windowID }) else {
                throw RecorderError.noSource
            }
            return (SCContentFilter(desktopIndependentWindow: window), window.frame, nil)
        }
    }

    private func finish() {
        camera.hide()
        controlBar.hide()
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
