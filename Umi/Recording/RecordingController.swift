import AVFoundation
import Observation
import ScreenCaptureKit

/// Drives a recording session: permissions, countdown, camera bubble, segments and saving.
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

    private let recorder = ScreenRecorder()
    private let camera = CameraBubbleController()
    private let countdown = CountdownOverlay()
    private var startTask: Task<Void, Never>?
    private var segments: [URL] = []
    private var accumulated: TimeInterval = 0
    private var segmentStartedAt: Date?

    var elapsed: TimeInterval {
        accumulated + (segmentStartedAt.map { Date().timeIntervalSince($0) } ?? 0)
    }

    init() {
        recorder.onUnexpectedStop = { [weak self] _ in
            guard let self, self.phase == .recording || self.phase == .paused else { return }
            self.stop()
        }
    }

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
        guard phase == .recording else { return }
        phase = .paused
        closeSegmentClock()
        Task {
            do { try await recorder.endSegment() } catch { fail(error) }
        }
    }

    func resume() {
        guard phase == .paused else { return }
        Task {
            do {
                let url = Self.newSegmentURL()
                try await recorder.beginSegment(at: url)
                segments.append(url)
                segmentStartedAt = Date()
                phase = .recording
            } catch {
                fail(error)
            }
        }
    }

    func stop() {
        guard phase == .recording || phase == .paused else { return }
        phase = .finishing
        closeSegmentClock()
        Task {
            await recorder.stop()
            do {
                let destination = try RecordingsLibrary.newRecordingURL()
                try await SegmentMerger.merge(segments, into: destination)
                lastFinishedURL = destination
            } catch {
                lastError = "Couldn't save the recording: \(error.localizedDescription)"
            }
            reset()
        }
    }

    func cancel() {
        startTask?.cancel()
        countdown.dismiss()
        let wasRunning = phase == .recording || phase == .paused
        Task {
            if wasRunning { await recorder.stop() }
            for url in segments { try? FileManager.default.removeItem(at: url) }
            reset()
        }
    }

    // MARK: Private

    private func runStart() async {
        guard await ensurePermissions() else { return }
        await refreshSources()

        if settings.countdown {
            phase = .countingDown
            let completed = await countdown.run(seconds: 3)
            guard completed, !Task.isCancelled else { reset(); return }
        }

        do {
            let filter = try await makeFilter()
            let url = Self.newSegmentURL()
            try await recorder.start(filter: filter, configuration: makeConfiguration(for: filter), firstSegment: url)
            segments = [url]
            accumulated = 0
            segmentStartedAt = Date()
            phase = .recording
        } catch {
            fail(error)
        }
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

    private func makeFilter() async throws -> SCContentFilter {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        switch settings.mode {
        case .display:
            guard let display = content.displays.first(where: { $0.displayID == settings.displayID }) else {
                throw RecorderError.noSource
            }
            // Hide Umi's own UI (menu, countdown) but keep the camera bubble in the video.
            let pid = ProcessInfo.processInfo.processIdentifier
            let bubbleID = camera.windowNumber.map { CGWindowID($0) }
            let hidden = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowID != bubbleID }
            return SCContentFilter(display: display, excludingWindows: hidden)
        case .window:
            guard let window = content.windows.first(where: { $0.windowID == settings.windowID }) else {
                throw RecorderError.noSource
            }
            return SCContentFilter(desktopIndependentWindow: window)
        }
    }

    private func makeConfiguration(for filter: SCContentFilter) -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        // H.264 dimensions must be even.
        config.width = Int(filter.contentRect.width * scale) & ~1
        config.height = Int(filter.contentRect.height * scale) & ~1
        config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        config.queueDepth = 6
        config.showsCursor = true
        config.capturesAudio = settings.captureSystemAudio
        config.excludesCurrentProcessAudio = true
        config.captureMicrophone = settings.captureMicrophone
        if settings.captureMicrophone {
            config.microphoneCaptureDeviceID = AVCaptureDevice.default(for: .audio)?.uniqueID
        }
        return config
    }

    private func closeSegmentClock() {
        if let start = segmentStartedAt { accumulated += Date().timeIntervalSince(start) }
        segmentStartedAt = nil
    }

    private func fail(_ error: Error) {
        lastError = error.localizedDescription
        cancel()
    }

    private func reset() {
        camera.hide()
        phase = .idle
        segments = []
        accumulated = 0
        segmentStartedAt = nil
        startTask = nil
    }

    private static func newSegmentURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("umi-segment-\(UUID().uuidString)")
            .appendingPathExtension("mov")
    }
}
