import AVFoundation
import ScreenCaptureKit

/// Captures screen video, system audio and microphone from one `SCStream` into `screen.mov`.
/// The cursor is not drawn into the video; `CursorRecorder` logs it separately for the editor.
nonisolated final class ScreenCapture: NSObject, @unchecked Sendable {
    struct AudioTracks {
        var system: Int?
        var microphone: Int?
    }

    private let queue = DispatchQueue(label: "cam.umi.screen", qos: .userInteractive)
    private var stream: SCStream!
    private let writer: MovieWriter
    private let clock: RecordingClock
    private let tracks: AudioTracks

    /// Called when macOS ends the stream on its own (e.g. "Stop Sharing" in the menu bar
    /// or the recorded window closing).
    var onUnexpectedStop: (@Sendable (Error) -> Void)?

    init(filter: SCContentFilter, configuration: SCStreamConfiguration, writer: MovieWriter, tracks: AudioTracks, clock: RecordingClock) throws {
        self.writer = writer
        self.clock = clock
        self.tracks = tracks
        super.init()
        stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if tracks.system != nil { try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
        if tracks.microphone != nil { try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue) }
    }

    func start() async throws {
        try await stream.startCapture()
    }

    func stop() async {
        try? await stream.stopCapture()
    }

    static func makeConfiguration(for filter: SCContentFilter, fps: Int, systemAudio: Bool, microphone: Bool) -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        // H.264 needs even dimensions.
        config.width = Int(filter.contentRect.width * scale) & ~1
        config.height = Int(filter.contentRect.height * scale) & ~1
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.queueDepth = 8
        config.showsCursor = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.colorSpaceName = CGColorSpace.sRGB
        config.capturesAudio = systemAudio
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        config.captureMicrophone = microphone
        if microphone {
            config.microphoneCaptureDeviceID = AVCaptureDevice.default(for: .audio)?.uniqueID
        }
        return config
    }
}

nonisolated extension ScreenCapture: SCStreamOutput {
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard buffer.isValid, let time = clock.map(buffer.presentationTimeStamp) else { return }
        switch type {
        case .screen:
            guard buffer.isCompleteScreenFrame else { return }
            writer.appendVideo(buffer, at: time)
        case .audio:
            if let track = tracks.system { writer.appendAudio(buffer, track: track, at: time) }
        case .microphone:
            if let track = tracks.microphone { writer.appendAudio(buffer, track: track, at: time) }
        @unknown default:
            break
        }
    }
}

nonisolated extension ScreenCapture: SCStreamDelegate {
    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        onUnexpectedStop?(error)
    }
}

nonisolated private extension CMSampleBuffer {
    /// ScreenCaptureKit also delivers "idle" frames with no new image; skip those.
    var isCompleteScreenFrame: Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(self, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: raw)
        else { return false }
        return status == .complete
    }
}
