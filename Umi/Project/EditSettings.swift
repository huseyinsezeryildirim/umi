import CoreGraphics
import Foundation

/// Every non-destructive edit of a recording. Stored in project.json; the source
/// tracks are never modified. All sizes are fractions so they're resolution-independent.
nonisolated struct EditSettings: Codable, Hashable, Sendable {
    var background = Background.gradient(.dusk)
    /// Space around the screen, as a fraction of the canvas' shorter side.
    var padding = 0.08
    /// Screen corner radius, as a fraction of the screen's shorter side.
    var cornerRadius = 0.025
    /// 0…1
    var shadow = 0.6
    var cursor = Cursor()
    var camera = Camera()
    var zoom = Zoom()
    /// Kept parts of the recording, in recording time, in order. Empty = keep everything.
    var clips: [TimeRangeValue] = []

    enum Background: Codable, Hashable, Sendable {
        case color(RGBA)
        case gradient(GradientPreset)
    }

    enum GradientPreset: String, Codable, CaseIterable, Sendable {
        case dusk, ocean, mint, peach, grape, night, sand, umay

        var colors: (RGBA, RGBA) {
            switch self {
            case .dusk: (RGBA(0.98, 0.45, 0.42), RGBA(0.42, 0.29, 0.86))
            case .ocean: (RGBA(0.13, 0.60, 0.95), RGBA(0.08, 0.20, 0.55))
            case .mint: (RGBA(0.55, 0.93, 0.76), RGBA(0.11, 0.55, 0.55))
            case .peach: (RGBA(1.00, 0.80, 0.62), RGBA(0.96, 0.47, 0.52))
            case .grape: (RGBA(0.80, 0.45, 0.95), RGBA(0.30, 0.15, 0.60))
            case .night: (RGBA(0.20, 0.22, 0.30), RGBA(0.05, 0.05, 0.09))
            case .sand: (RGBA(0.96, 0.91, 0.82), RGBA(0.82, 0.71, 0.58))
            case .umay: (RGBA(1.00, 0.62, 0.78), RGBA(0.55, 0.78, 1.00))
            }
        }
    }

    struct Cursor: Codable, Hashable, Sendable {
        var visible = true
        /// Multiplier on the system cursor size.
        var size = 1.5
        var smoothing = Smoothing.smooth
        var clickRings = true
    }

    enum Smoothing: String, Codable, CaseIterable, Sendable {
        case off, slow, smooth, fast

        /// Spring (tension, friction); nil = raw cursor.
        var spring: (tension: Double, friction: Double)? {
            switch self {
            case .off: nil
            case .slow: (90, 20)
            case .smooth: (170, 26)
            case .fast: (400, 40)
            }
        }
    }

    struct Camera: Codable, Hashable, Sendable {
        var visible = true
        var shape = Shape.circle
        /// Diameter as a fraction of the canvas' shorter side.
        var size = 0.24
        /// Center, normalized to the canvas (top-left origin).
        var position = CGPoint(x: 0.14, y: 0.80)
        var mirrored = true

        enum Shape: String, Codable, CaseIterable, Sendable {
            case circle, squircle, square
        }
    }

    struct Zoom: Codable, Hashable, Sendable {
        /// Generate zoom segments from clicks.
        var auto = true
        var scale = 1.8
        /// Manual segments; when `auto` is on they're added to the generated ones.
        var segments: [ZoomSegment] = []
    }

    struct ZoomSegment: Codable, Hashable, Sendable, Identifiable {
        var id = UUID()
        var start: Double
        var end: Double
        var scale: Double
        /// Fixed focus (normalized screen, top-left origin); nil = follow the cursor.
        var focus: CGPoint?
    }
}

nonisolated struct RGBA: Codable, Hashable, Sendable {
    var r, g, b, a: Double
    init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }
}

nonisolated struct TimeRangeValue: Codable, Hashable, Sendable {
    var start: Double
    var end: Double
    var duration: Double { end - start }
}
