import AVFoundation
import Observation
import os

/// Live input level of the chosen microphone, for the launcher's meter.
/// Runs its own lightweight capture session only while the launcher is open.
@Observable
final class MicLevelMonitor {
    /// 0…1
    private(set) var level: Double = 0

    private let worker = Worker()
    private var timer: Timer?

    func start(deviceID: String?) {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { return }
        worker.start(deviceID: deviceID)
        timer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 20.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                // Fast attack, slow release, so the bar reads like a VU meter.
                let target = self.worker.currentLevel
                self.level = target > self.level ? target : self.level * 0.8 + target * 0.2
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        worker.stop()
        level = 0
    }

    private nonisolated final class Worker: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
        private let session = AVCaptureSession()
        private let queue = DispatchQueue(label: "cam.umi.miclevel")
        private let output = AVCaptureAudioDataOutput()
        private let latest = OSAllocatedUnfairLock(initialState: 0.0)

        var currentLevel: Double { latest.withLock { $0 } }

        func start(deviceID: String?) {
            queue.async { [self] in
                session.beginConfiguration()
                session.inputs.forEach(session.removeInput)
                let device = deviceID.flatMap(AVCaptureDevice.init(uniqueID:)) ?? AVCaptureDevice.default(for: .audio)
                if let device, let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
                    session.addInput(input)
                }
                if session.outputs.isEmpty, session.canAddOutput(output) {
                    output.setSampleBufferDelegate(self, queue: queue)
                    session.addOutput(output)
                }
                session.commitConfiguration()
                if !session.isRunning { session.startRunning() }
            }
        }

        func stop() {
            queue.async { [self] in
                if session.isRunning { session.stopRunning() }
                latest.withLock { $0 = 0 }
            }
        }

        func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
            // averagePowerLevel is in dBFS; map -50…0 dB to 0…1.
            let power = connection.audioChannels.map(\.averagePowerLevel).max() ?? -160
            let normalized = min(max((Double(power) + 50) / 50, 0), 1)
            latest.withLock { $0 = normalized }
        }
    }
}

/// Audio and video inputs for the launcher's device menus.
enum CaptureDevices {
    static var microphones: [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified).devices
    }

    static var cameras: [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera], mediaType: .video, position: .unspecified).devices
    }
}
