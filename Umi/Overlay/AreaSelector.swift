import AppKit
import SwiftUI

/// Full-screen overlay for picking the part of the screen to record: drag a rectangle,
/// adjust it, then Enter / double-click to confirm or Escape to cancel.
final class AreaSelector {
    private var window: NSWindow?
    private var completion: ((CGRect?) -> Void)?
    private var keyMonitor: Any?

    /// Calls back with the rect in global screen points (top-left origin), or nil.
    func pick(on screen: NSScreen = NSScreen.main ?? NSScreen.screens[0], initial: CGRect?, confirmTitle: String = "Record This Area",
              completion: @escaping (CGRect?) -> Void) {
        close()
        self.completion = completion
        let frame = screen.frame
        let window = KeyableWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.level = .screenSaver
        window.isOpaque = false
        window.backgroundColor = .clear
        window.ignoresMouseEvents = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        // Initial rect in this window's (top-left) coordinates.
        let primaryHeight = NSScreen.screens.first?.frame.height ?? frame.height
        let screenTopLeft = CGPoint(x: frame.minX, y: primaryHeight - frame.maxY)
        let start = initial.map { $0.offsetBy(dx: -screenTopLeft.x, dy: -screenTopLeft.y) }
        let view = AreaSelectorView(initial: start, size: frame.size, confirmTitle: confirmTitle) { [weak self] rect in
            self?.finish(rect.map { $0.offsetBy(dx: screenTopLeft.x, dy: screenTopLeft.y) })
        }
        window.contentView = NSHostingView(rootView: view)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.finish(nil); return nil } // Escape
            return event
        }
        self.window = window
    }

    private func finish(_ rect: CGRect?) {
        let completion = completion
        close()
        completion?(rect)
    }

    private func close() {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
        window?.orderOut(nil)
        window = nil
        completion = nil
    }

    private final class KeyableWindow: NSWindow {
        override var canBecomeKey: Bool { true }
    }
}

private struct AreaSelectorView: View {
    @State private var rect: CGRect?
    @State private var dragStart: CGPoint?
    @State private var moveOrigin: CGRect?
    let size: CGSize
    let confirmTitle: String
    let done: (CGRect?) -> Void

    init(initial: CGRect?, size: CGSize, confirmTitle: String, done: @escaping (CGRect?) -> Void) {
        _rect = State(initialValue: initial)
        self.size = size
        self.confirmTitle = confirmTitle
        self.done = done
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Dim everything but the selection.
            Canvas { context, canvasSize in
                var path = Path(CGRect(origin: .zero, size: canvasSize))
                if let rect { path.addRect(rect) }
                context.fill(path, with: .color(.black.opacity(0.45)), style: FillStyle(eoFill: true))
            }
            .ignoresSafeArea()

            if let rect {
                Rectangle()
                    .strokeBorder(Color.white, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                    .frame(width: rect.width, height: rect.height)
                    .offset(x: rect.minX, y: rect.minY)
                    .allowsHitTesting(false)
                Text("\(Int(rect.width)) × \(Int(rect.height))")
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(.black.opacity(0.7)))
                    .foregroundStyle(.white)
                    .offset(x: rect.minX, y: max(rect.minY - 28, 4))
                    .allowsHitTesting(false)
                HStack(spacing: 8) {
                    Button("Cancel") { done(nil) }
                        .buttonStyle(GlassButtonStyle(height: 34, cornerRadius: 11))
                    Button(confirmTitle) { done(rect) }
                        .buttonStyle(InkCompactButtonStyle())
                        .keyboardShortcut(.defaultAction)
                }
                .offset(x: min(rect.minX, size.width - 260), y: min(rect.maxY + 10, size.height - 50))
            } else {
                Text("Drag to select an area · Esc to cancel")
                    .font(.system(size: 15, weight: .medium))
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Capsule().fill(.black.opacity(0.7)))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { value in
                if dragStart == nil {
                    dragStart = value.startLocation
                    // Starting inside the selection moves it; outside draws a new one.
                    moveOrigin = rect?.contains(value.startLocation) == true ? rect : nil
                }
                if let origin = moveOrigin {
                    var moved = origin.offsetBy(dx: value.translation.width, dy: value.translation.height)
                    moved.origin.x = min(max(moved.minX, 0), size.width - moved.width)
                    moved.origin.y = min(max(moved.minY, 0), size.height - moved.height)
                    rect = moved
                } else {
                    let a = value.startLocation, b = value.location
                    rect = CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y)).integral
                }
            }
            .onEnded { _ in
                dragStart = nil
                moveOrigin = nil
                if let r = rect, r.width < 40 || r.height < 40 { rect = nil }
            })
        .onTapGesture(count: 2) { if let rect { done(rect) } }
        .onHover { inside in if inside { NSCursor.crosshair.push() } else { NSCursor.pop() } }
    }
}
