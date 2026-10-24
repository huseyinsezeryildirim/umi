import CoreGraphics
import Foundation

/// Zoom level and focus point over time, from manual segments and (optionally)
/// segments generated from clicks.
nonisolated struct ZoomTrack: Sendable {
    let segments: [EditSettings.ZoomSegment]
    /// A slow, heavily damped cursor the zoom follows, so the view glides instead of jittering.
    private let follow: CursorTrack

    static let ramp = 0.5

    init(settings: EditSettings.Zoom, cursor: CursorData, duration: Double) {
        var all = settings.segments
        if settings.auto {
            all += Self.autoSegments(from: cursor.clicks, scale: settings.scale, duration: duration)
        }
        segments = all.sorted { $0.start < $1.start }
        follow = CursorTrack(data: cursor, duration: duration, spring: (tension: 30, friction: 11))
    }

    /// Clicks close together become one segment that starts just before the first
    /// click and holds a moment after the last.
    static func autoSegments(from clicks: [CursorData.Click], scale: Double, duration: Double) -> [EditSettings.ZoomSegment] {
        let lefts = clicks.filter { $0.button == .left }.sorted { $0.t < $1.t }
        var result: [EditSettings.ZoomSegment] = []
        var groupStart: Double?, groupEnd = 0.0
        func flush() {
            guard let start = groupStart else { return }
            let begin = max(0, start - 0.6)
            // A stable id (from the start time) so a generated zoom stays selected across rebuilds.
            let id = UUID(uuidString: String(format: "00000000-0000-4000-8000-%012llx", UInt64(begin * 1000))) ?? UUID()
            let segment = EditSettings.ZoomSegment(id: id, start: begin, end: min(duration, groupEnd + 1.8), scale: scale)
            if let last = result.last, segment.start <= last.end {
                result[result.count - 1].end = segment.end
            } else {
                result.append(segment)
            }
        }
        for click in lefts {
            if let _ = groupStart, click.t - groupEnd < 3 {
                groupEnd = click.t
            } else {
                flush()
                groupStart = click.t
                groupEnd = click.t
            }
        }
        flush()
        return result
    }

    /// Current zoom factor (≥ 1) and focus, normalized to the screen (top-left origin).
    func state(at t: Double) -> (scale: Double, focus: CGPoint) {
        var best: (amount: Double, segment: EditSettings.ZoomSegment)?
        for segment in segments where t >= segment.start && t <= segment.end {
            let ramp = min(Self.ramp, (segment.end - segment.start) / 2)
            let amount = min((t - segment.start) / ramp, (segment.end - t) / ramp, 1)
            if amount > (best?.amount ?? 0) { best = (amount, segment) }
        }
        guard let best else { return (1, CGPoint(x: 0.5, y: 0.5)) }
        let eased = Self.ease(best.amount)
        let focus = best.segment.focus ?? follow.position(at: t) ?? CGPoint(x: 0.5, y: 0.5)
        return (1 + (best.segment.scale - 1) * eased, focus)
    }

    private static func ease(_ x: Double) -> Double {
        // easeInOutCubic
        x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2
    }
}
