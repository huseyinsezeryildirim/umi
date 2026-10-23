import AppKit
import AVFoundation

/// A round, draggable, always-on-top camera preview. The camera is recorded to its own
/// track, so the bubble is left out of the screen capture and composited by the editor.
final class CameraBubbleController {
    private var panel: NSPanel?
    let session = CameraSession()
    private let diameter: CGFloat = 200

    var windowNumber: Int? { panel?.isVisible == true ? panel?.windowNumber : nil }

    /// The bubble's center normalized to `rect` (global points, top-left origin).
    func normalizedCenter(in rect: CGRect) -> CGPoint? {
        guard let frame = panel?.frame, panel?.isVisible == true else { return nil }
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let center = CGPoint(x: frame.midX, y: primaryHeight - frame.midY)
        return CGPoint(x: (center.x - rect.minX) / max(rect.width, 1), y: (center.y - rect.minY) / max(rect.height, 1))
    }

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
