import AppKit
import AVFoundation

/// A round, draggable, always-on-top camera preview. It's a real window on screen,
/// so the screen recording picks it up the same way Loom's bubble does.
final class CameraBubbleController {
    private var panel: NSPanel?
    private let session = CameraSession()
    private let diameter: CGFloat = 200

    var windowNumber: Int? { panel?.isVisible == true ? panel?.windowNumber : nil }

    func show() {
        Task {
            guard await AVCaptureDevice.requestAccess(for: .video) else { return }
            let panel = self.panel ?? makePanel()
            self.panel = panel
            panel.orderFrontRegardless()
            session.start()
        }
    }

    func hide() {
        panel?.orderOut(nil)
        session.stop()
    }

    private func makePanel() -> NSPanel {
        let screen = NSScreen.main?.visibleFrame ?? .zero
        let frame = NSRect(x: screen.minX + 32, y: screen.minY + 32, width: diameter, height: diameter)
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hidesOnDeactivate = false

        let view = NSView(frame: NSRect(origin: .zero, size: frame.size))
        view.wantsLayer = true
        view.layer?.cornerRadius = diameter / 2
        view.layer?.masksToBounds = true
        view.layer?.borderWidth = 3
        view.layer?.borderColor = NSColor.white.withAlphaComponent(0.9).cgColor
        view.layer?.backgroundColor = NSColor.black.cgColor

        let preview = AVCaptureVideoPreviewLayer(session: session.captureSession)
        preview.frame = view.bounds
        preview.videoGravity = .resizeAspectFill
        preview.connection?.automaticallyAdjustsVideoMirroring = false
        preview.connection?.isVideoMirrored = true
        view.layer?.addSublayer(preview)

        panel.contentView = view
        return panel
    }
}

/// Owns the `AVCaptureSession` and runs its blocking start/stop calls off the main thread.
nonisolated final class CameraSession: @unchecked Sendable {
    let captureSession = AVCaptureSession()
    private let queue = DispatchQueue(label: "cam.umi.camera")
    private var configured = false

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

    private func configure() {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .high
        if let device = AVCaptureDevice.default(for: .video),
           let input = try? AVCaptureDeviceInput(device: device),
           captureSession.canAddInput(input) {
            captureSession.addInput(input)
        }
        captureSession.commitConfiguration()
        configured = true
    }
}
