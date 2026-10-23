import AVFoundation
import os

/// Owns the `AVCaptureSession` used for both the bubble preview and `camera.mov`.
/// Blocking session calls and frame delivery run on a private queue.
nonisolated final class CameraSession: NSObject, @unchecked Sendable {
    let captureSession = AVCaptureSession()
    private let queue = DispatchQueue(label: "cam.umi.camera", qos: .userInteractive)
    private let output = AVCaptureVideoDataOutput()
    private var configured = false
    private let recording = OSAllocatedUnfairLock<CameraRecording?>(initialState: nil)

    func start() {
        queue.async { [self] in
            if !configured { configure() }
            if !captureSession.isRunning { captureSession.startRunning() }
        }
    }

    func stop() {
        queue.async { [self] in
            if captureSession.isRunning { captureSession.stopRunning() }
        }
    }

    /// Starts writing frames to `url`. The writer is created on the first frame so it
    /// matches the camera's real dimensions.
    func startRecording(to url: URL, clock: RecordingClock) {
        start()
        recording.withLock { $0 = CameraRecording(url: url, clock: clock) }
    }

    /// Finishes the file. Returns `false` if no frame was ever written.
    func finishRecording(at end: CMTime) async -> Bool {
        let current = recording.withLock { state -> CameraRecording? in
            defer { state = nil }
            return state
        }
        guard let writer = current?.writer else { return false }
        await writer.finish(at: end)
        return true
    }

    func cancelRecording() {
        recording.withLock { state in
            state?.writer?.cancel()
            state = nil
        }
    }

    private func configure() {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .high
        if let device = AVCaptureDevice.default(for: .video),
           let input = try? AVCaptureDeviceInput(device: device),
           captureSession.canAddInput(input) {
            captureSession.addInput(input)
        }
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        if captureSession.canAddOutput(output) { captureSession.addOutput(output) }
        captureSession.commitConfiguration()
        configured = true
    }
}

nonisolated extension CameraSession: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput buffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let hostTime = CMSyncConvertTime(buffer.presentationTimeStamp, from: captureSession.synchronizationClock ?? CMClockGetHostTimeClock(), to: CMClockGetHostTimeClock())
        recording.withLockUnchecked { state in
            guard var current = state, let time = current.clock.map(hostTime) else { return }
            if current.writer == nil, let image = buffer.imageBuffer {
                let width = CVPixelBufferGetWidth(image) & ~1, height = CVPixelBufferGetHeight(image) & ~1
                current.writer = try? MovieWriter(url: current.url, video: .init(width: width, height: height, fps: 30), audio: [])
                state = current
            }
            current.writer?.appendVideo(buffer, at: time)
        }
    }
}

private nonisolated struct CameraRecording {
    let url: URL
    let clock: RecordingClock
    var writer: MovieWriter?
}
