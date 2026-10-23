import AppKit
import AVFoundation
import SwiftUI

/// A draggable, resizable, always-on-top camera preview with Loom-style hover controls.
/// The camera is recorded to its own track, so the bubble (controls included) is left out
/// of the screen capture and composited by the editor with the same shape, size and mirror.
final class CameraBubbleController {
    private var panel: NSPanel?
    let session = CameraSession()
    private let model = CameraBubbleModel(style: .load())
    /// Called when the user closes the bubble with its × button. The owner should turn its
    /// "show camera" setting off and call `hide()` (or `hidePanel()` mid-recording). When
    /// unset, the bubble simply hides itself and stops the camera.
    var onHide: (() -> Void)?

    private var dragStart: (mouse: CGPoint, origin: CGPoint)?
    private var resizeStart: (mouse: CGPoint, frame: CGRect)?
    /// Gap kept between the bubble and the screen edges when it snaps.
    private let margin: CGFloat = 24

    var windowNumber: Int? { panel?.isVisible == true ? panel?.windowNumber : nil }
    var isVisible: Bool { panel?.isVisible == true }

    /// The bubble's center normalized to `rect` (global points, top-left origin).
    func normalizedCenter(in rect: CGRect) -> CGPoint? {
        guard let frame = panel?.frame, panel?.isVisible == true else { return nil }
        return Self.normalize(CGPoint(x: frame.midX, y: frame.midY), in: rect)
    }

    /// The bubble as the editor should start with it, relative to the captured area.
    func editCamera(in rect: CGRect) -> EditSettings.Camera {
        var camera = EditSettings.Camera()
        camera.visible = isVisible
        camera.shape = model.style.shape
        camera.mirrored = model.style.mirrored
        let frame = panel?.frame ?? frameForSavedStyle()
        camera.size = min(max(frame.width / max(min(rect.width, rect.height), 1), 0.1), 0.45)
        let center = Self.normalize(CGPoint(x: frame.midX, y: frame.midY), in: rect)
        camera.position = CGPoint(x: min(max(center.x, 0.08), 0.92), y: min(max(center.y, 0.1), 0.9))
        return camera
    }

    /// Starts the camera and shows the bubble.
    func show() {
        Task {
            guard await AVCaptureDevice.requestAccess(for: .video) else { return }
            showPanel()
            session.start()
        }
    }

    /// Stops the camera and hides the bubble.
    func hide() {
        hidePanel()
        session.stop()
    }

    /// Shows the bubble without touching the camera session.
    func showPanel() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        panel.orderFrontRegardless()
    }

    /// Hides the bubble but keeps the camera running (e.g. mid-recording).
    func hidePanel() {
        model.isHovering = false
        panel?.orderOut(nil)
    }

    // MARK: Controls

    private func setSize(_ size: CameraBubbleStyle.Size) {
        guard let panel else { return }
        let d = size.diameter
        let frame = CGRect(x: panel.frame.midX - d / 2, y: panel.frame.midY - d / 2, width: d, height: d)
        model.style.diameter = d
        move(to: snapped(frame), animate: true)
    }

    private func setShape(_ shape: EditSettings.Camera.Shape) {
        model.style.shape = shape
        save()
        refreshShadow(after: 0.35)
    }

    private func toggleMirror() {
        model.style.mirrored.toggle()
        save()
    }

    private func drag(ended: Bool) {
        guard let panel else { return }
        let mouse = NSEvent.mouseLocation
        if ended {
            dragStart = nil
            move(to: snapped(panel.frame), animate: true)
            return
        }
        if dragStart == nil { dragStart = (mouse, panel.frame.origin) }
        guard let start = dragStart else { return }
        panel.setFrameOrigin(CGPoint(x: start.origin.x + mouse.x - start.mouse.x, y: start.origin.y + mouse.y - start.mouse.y))
    }

    /// The handle sits at the bottom-right; dragging it down/right grows the bubble
    /// around its center.
    private func resize(ended: Bool) {
        guard let panel else { return }
        let mouse = NSEvent.mouseLocation
        if ended {
            resizeStart = nil
            let frame = snapped(panel.frame)
            move(to: frame, animate: true)
            model.isHovering = frame.contains(mouse)
            return
        }
        if resizeStart == nil { resizeStart = (mouse, panel.frame) }
        guard let start = resizeStart else { return }
        let growth = (mouse.x - start.mouse.x) - (mouse.y - start.mouse.y)
        let range = CameraBubbleStyle.diameterRange
        let d = min(max(start.frame.width + growth, range.lowerBound), min(range.upperBound, maxDiameter(near: start.frame)))
        model.style.diameter = d
        panel.setFrame(CGRect(x: start.frame.midX - d / 2, y: start.frame.midY - d / 2, width: d, height: d), display: true)
    }

    // MARK: Layout

    private func move(to frame: CGRect, animate: Bool) {
        panel?.setFrame(frame, display: true, animate: animate)
        model.style.diameter = frame.width
        model.style.center = CGPoint(x: frame.midX, y: frame.midY)
        save()
        refreshShadow(after: animate ? 0.3 : 0)
    }

    /// Keeps `frame` on its screen with a margin, pulls it to the nearest edge and, when
    /// it's close to one, into the corner.
    private func snapped(_ frame: CGRect) -> CGRect {
        let area = Self.screen(containing: CGPoint(x: frame.midX, y: frame.midY)).visibleFrame.insetBy(dx: margin, dy: margin)
        let d = min(frame.width, area.width, area.height)
        var f = CGRect(x: frame.midX - d / 2, y: frame.midY - d / 2, width: d, height: d)
        f.origin.x = min(max(f.minX, area.minX), area.maxX - d)
        f.origin.y = min(max(f.minY, area.minY), area.maxY - d)

        let left = f.minX - area.minX, right = area.maxX - f.maxX
        let bottom = f.minY - area.minY, top = area.maxY - f.maxY
        let toLeft = left <= right, toBottom = bottom <= top
        if min(left, right) <= min(bottom, top) {
            f.origin.x = toLeft ? area.minX : area.maxX - d
            if min(bottom, top) < (area.height - d) * 0.2 { f.origin.y = toBottom ? area.minY : area.maxY - d }
        } else {
            f.origin.y = toBottom ? area.minY : area.maxY - d
            if min(left, right) < (area.width - d) * 0.2 { f.origin.x = toLeft ? area.minX : area.maxX - d }
        }
        return f
    }

    private func maxDiameter(near frame: CGRect) -> CGFloat {
        let area = Self.screen(containing: CGPoint(x: frame.midX, y: frame.midY)).visibleFrame
        return min(area.width, area.height) - margin * 2
    }

    private func frameForSavedStyle() -> CGRect {
        let d = model.style.diameter
        if let center = model.style.center, NSScreen.screens.contains(where: { $0.visibleFrame.contains(center) }) {
            return snapped(CGRect(x: center.x - d / 2, y: center.y - d / 2, width: d, height: d))
        }
        let area = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? .zero
        return snapped(CGRect(x: area.minX, y: area.minY, width: d, height: d))
    }

    private func save() {
        model.style.save()
    }

    private func refreshShadow(after delay: TimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.panel?.invalidateShadow()
        }
    }

    private static func screen(containing point: CGPoint) -> NSScreen {
        NSScreen.screens.first { $0.frame.contains(point) }
            ?? NSScreen.screens.min { distance($0.frame, point) < distance($1.frame, point) }
            ?? NSScreen.main!
    }

    private static func distance(_ rect: CGRect, _ point: CGPoint) -> CGFloat {
        hypot(rect.midX - point.x, rect.midY - point.y)
    }

    /// Normalizes an AppKit-global point to `rect` (global points, top-left origin).
    private static func normalize(_ point: CGPoint, in rect: CGRect) -> CGPoint {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let flipped = CGPoint(x: point.x, y: primaryHeight - point.y)
        return CGPoint(x: (flipped.x - rect.minX) / max(rect.width, 1), y: (flipped.y - rect.minY) / max(rect.height, 1))
    }

    private func makePanel() -> NSPanel {
        let frame = frameForSavedStyle()
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hidesOnDeactivate = false

        let actions = CameraBubbleActions(
            setSize: { [weak self] in self?.setSize($0) },
            setShape: { [weak self] in self?.setShape($0) },
            toggleMirror: { [weak self] in self?.toggleMirror() },
            hide: { [weak self] in
                guard let self else { return }
                if let onHide { onHide() } else { hide() }
            },
            drag: { [weak self] in self?.drag(ended: $0) },
            resize: { [weak self] in self?.resize(ended: $0) }
        )
        let host = BubbleHostingView(rootView: CameraBubbleView(session: session.captureSession, model: model, actions: actions))
        host.sizingOptions = []
        host.onHover = { [weak self] hovering in
            // Keep the controls (and the resize handle being dragged) up mid-gesture.
            guard let self, hovering || (dragStart == nil && resizeStart == nil) else { return }
            model.isHovering = hovering
        }
        host.frame = NSRect(origin: .zero, size: frame.size)
        host.autoresizingMask = [.width, .height]
        panel.contentView = host
        return panel
    }
}

/// Lets the controls work on the first click without activating Umi, and tracks hover
/// even though the panel is never key.
private final class BubbleHostingView<Content: View>: NSHostingView<Content> {
    var onHover: ((Bool) -> Void)?

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if !trackingAreas.contains(where: { $0.owner === self && $0.userInfo?["bubble"] != nil }) {
            addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: ["bubble": true]))
        }
    }

    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        onHover?(true)
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        onHover?(false)
    }
}
