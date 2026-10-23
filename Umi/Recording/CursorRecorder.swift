import AppKit

/// Logs cursor position and clicks during a recording, in recording time, normalized
/// to the captured area (0…1, top-left origin). The editor uses this to draw a smooth
/// cursor, click rings and auto zoom.
final class CursorRecorder {
    private let clock: RecordingClock
    private let captureRect: CGRect
    private var data = CursorData()
    private var timer: Timer?
    private var monitors: [Any] = []
    private var lastPoint: CGPoint?

    /// - Parameter captureRect: captured area in global screen points, top-left origin.
    init(clock: RecordingClock, captureRect: CGRect) {
        self.clock = clock
        self.captureRect = captureRect
    }

    func start() {
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.sample() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer

        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        if let global = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] event in
            self?.click(event)
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] event in
            self?.click(event)
            return event
        }) { monitors.append(local) }
    }

    func stop() -> CursorData {
        timer?.invalidate()
        timer = nil
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        return data
    }

    private func sample() {
        guard let time = clock.now else { return }
        let point = normalized(NSEvent.mouseLocation)
        guard point != lastPoint else { return }
        lastPoint = point
        data.moves.append(.init(t: time.seconds, x: point.x, y: point.y))
    }

    private func click(_ event: NSEvent) {
        guard let time = clock.now else { return }
        let point = normalized(NSEvent.mouseLocation)
        let button: CursorData.Click.Button = switch event.type {
        case .rightMouseDown: .right
        case .otherMouseDown: .other
        default: .left
        }
        data.clicks.append(.init(t: time.seconds, x: point.x, y: point.y, button: button))
    }

    /// AppKit's mouse location is bottom-left based on the primary screen; convert to
    /// top-left global coordinates, then into the capture rect.
    private func normalized(_ location: NSPoint) -> CGPoint {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let global = CGPoint(x: location.x, y: primaryHeight - location.y)
        return CGPoint(
            x: (global.x - captureRect.minX) / max(captureRect.width, 1),
            y: (global.y - captureRect.minY) / max(captureRect.height, 1)
        )
    }
}
