import AVFoundation
import ScreenCaptureKit

/// Wraps a single `SCStream` and writes it to disk in segments.
///
/// Pausing ends the current segment file and resuming starts a new one on the same
/// running stream; `SegmentMerger` stitches the files together when recording stops.
final class ScreenRecorder: NSObject {
    private var stream: SCStream?
    private var output: SCRecordingOutput?
    private var startContinuation: CheckedContinuation<Void, Error>?
    private var finishContinuation: CheckedContinuation<Void, Error>?

    /// Called when the system stops the stream on its own (e.g. the user clicked
    /// "Stop Sharing" in the macOS menu bar, or the recorded window closed).
    var onUnexpectedStop: ((Error) -> Void)?

    func start(filter: SCContentFilter, configuration: SCStreamConfiguration, firstSegment url: URL) async throws {
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        self.stream = stream
        try addOutput(writingTo: url, on: stream)
        try await withCheckedThrowingContinuation { continuation in
            startContinuation = continuation
            stream.startCapture { error in
                guard let error else { return }
                Task { @MainActor in self.resumeStart(throwing: error) }
            }
        }
    }

    func beginSegment(at url: URL) async throws {
        guard let stream else { throw RecorderError.notRunning }
        try await withCheckedThrowingContinuation { continuation in
            startContinuation = continuation
            do {
                try addOutput(writingTo: url, on: stream)
            } catch {
                resumeStart(throwing: error)
            }
        }
    }

    func endSegment() async throws {
        guard let stream, let output else { return }
        try await withCheckedThrowingContinuation { continuation in
            finishContinuation = continuation
            do {
                try stream.removeRecordingOutput(output)
            } catch {
                resumeFinish(throwing: error)
            }
        }
        self.output = nil
    }

    func stop() async {
        try? await endSegment()
        try? await stream?.stopCapture()
        stream = nil
    }

    private func addOutput(writingTo url: URL, on stream: SCStream) throws {
        let config = SCRecordingOutputConfiguration()
        config.outputURL = url
        config.outputFileType = .mov
        config.videoCodecType = .h264
        let output = SCRecordingOutput(configuration: config, delegate: self)
        try stream.addRecordingOutput(output)
        self.output = output
    }

    private func resumeStart(throwing error: Error? = nil) {
        guard let continuation = startContinuation else { return }
        startContinuation = nil
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }

    private func resumeFinish(throwing error: Error? = nil) {
        guard let continuation = finishContinuation else { return }
        finishContinuation = nil
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }
}

extension ScreenRecorder: SCStreamDelegate {
    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        Task { @MainActor in
            self.resumeStart(throwing: error)
            self.resumeFinish(throwing: error)
            self.stream = nil
            self.output = nil
            self.onUnexpectedStop?(error)
        }
    }
}

extension ScreenRecorder: SCRecordingOutputDelegate {
    nonisolated func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        Task { @MainActor in self.resumeStart() }
    }

    nonisolated func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: any Error) {
        Task { @MainActor in
            self.resumeStart(throwing: error)
            self.resumeFinish(throwing: error)
        }
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        Task { @MainActor in self.resumeFinish() }
    }
}

enum RecorderError: LocalizedError {
    case notRunning
    case noSource
    case screenPermissionDenied

    var errorDescription: String? {
        switch self {
        case .notRunning: "The recorder is not running."
        case .noSource: "Choose a screen or window to record."
        case .screenPermissionDenied: "Umi needs Screen Recording permission. Enable it in System Settings › Privacy & Security › Screen & System Audio Recording, then try again."
        }
    }
}
