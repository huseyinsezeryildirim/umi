import CoreGraphics
import Foundation

/// Cursor position over time, raw or spring-smoothed, sampled from `CursorData`.
/// Positions are normalized to the captured area, top-left origin.
nonisolated struct CursorTrack: Sendable {
    private let times: [Double]
    private let points: [CGPoint]
    let clicks: [CursorData.Click]

    private static let step = 1.0 / 120.0

    init(data: CursorData, duration: Double, spring: (tension: Double, friction: Double)?) {
        clicks = data.clicks
        let raw = data.moves
        guard let first = raw.first else {
            times = []; points = []
            return
        }
        guard let spring else {
            times = raw.map(\.t)
            points = raw.map { CGPoint(x: $0.x, y: $0.y) }
            return
        }

        // Integrate a damped spring chasing the raw cursor at a fixed rate.
        var t = 0.0, index = 0
        var position = CGPoint(x: first.x, y: first.y)
        var velocity = CGVector.zero
        var sampledTimes: [Double] = [], sampledPoints: [CGPoint] = []
        sampledTimes.reserveCapacity(Int(duration / Self.step) + 2)
        sampledPoints.reserveCapacity(Int(duration / Self.step) + 2)
        while t <= duration + Self.step {
            while index + 1 < raw.count, raw[index + 1].t <= t { index += 1 }
            let target = Self.interpolate(raw, at: t, from: index)
            let ax = spring.tension * (target.x - position.x) - spring.friction * velocity.dx
            let ay = spring.tension * (target.y - position.y) - spring.friction * velocity.dy
            velocity.dx += ax * Self.step
            velocity.dy += ay * Self.step
            position.x += velocity.dx * Self.step
            position.y += velocity.dy * Self.step
            sampledTimes.append(t)
            sampledPoints.append(position)
            t += Self.step
        }
        times = sampledTimes
        points = sampledPoints
    }

    var isEmpty: Bool { points.isEmpty }

    func position(at t: Double) -> CGPoint? {
        guard !points.isEmpty else { return nil }
        if t <= times[0] { return points[0] }
        if t >= times[times.count - 1] { return points[points.count - 1] }
        // Binary search for the last sample at or before t.
        var low = 0, high = times.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if times[mid] <= t { low = mid } else { high = mid - 1 }
        }
        let next = min(low + 1, times.count - 1)
        let span = times[next] - times[low]
        let f = span > 0 ? (t - times[low]) / span : 0
        return CGPoint(
            x: points[low].x + (points[next].x - points[low].x) * f,
            y: points[low].y + (points[next].y - points[low].y) * f
        )
    }

    private static func interpolate(_ raw: [CursorData.Move], at t: Double, from index: Int) -> CGPoint {
        let a = raw[index]
        guard index + 1 < raw.count, t > a.t else { return CGPoint(x: a.x, y: a.y) }
        let b = raw[index + 1]
        let f = min(max((t - a.t) / max(b.t - a.t, 0.0001), 0), 1)
        return CGPoint(x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f)
    }
}
