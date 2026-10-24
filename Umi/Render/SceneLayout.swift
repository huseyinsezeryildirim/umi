import CoreGraphics
import Foundation

/// Where the screen card and the camera sit on the canvas at a moment in time.
/// Rects are in Core Image coordinates (bottom-left origin, canvas pixels).
nonisolated struct SceneState: Sendable {
    /// Outer rect of the screen card, including any device frame chrome.
    var screenRect: CGRect
    var screenAlpha: Double
    var cameraRect: CGRect
    var cameraRadius: CGFloat
    var cameraAlpha: Double
    /// How much click/manual zoom applies: full in the default layouts, none when the
    /// canvas is shared with the camera (split, floating, camera only).
    var zoomAllowance: Double = 1

    func lerp(to other: SceneState, _ t: Double) -> SceneState {
        func l(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * t }
        func r(_ a: CGRect, _ b: CGRect) -> CGRect {
            CGRect(x: l(a.minX, b.minX), y: l(a.minY, b.minY), width: l(a.width, b.width), height: l(a.height, b.height))
        }
        return SceneState(
            screenRect: r(screenRect, other.screenRect),
            screenAlpha: screenAlpha + (other.screenAlpha - screenAlpha) * t,
            cameraRect: r(cameraRect, other.cameraRect),
            cameraRadius: l(cameraRadius, other.cameraRadius),
            cameraAlpha: cameraAlpha + (other.cameraAlpha - cameraAlpha) * t,
            zoomAllowance: zoomAllowance + (other.zoomAllowance - zoomAllowance) * t
        )
    }
}

/// Computes `SceneState` for each scene layout and blends between them over time.
nonisolated struct SceneLayoutEngine: Sendable {
    let settings: EditSettings
    /// Screen aspect ratio (width / height) of the recording.
    let screenAspect: Double
    let hasCamera: Bool

    func state(at t: Double, canvas: CGRect) -> SceneState {
        let segments = settings.scenes.sorted { $0.start < $1.start }
        guard let index = segments.firstIndex(where: { t >= $0.start && t < $0.end }) else {
            // After a segment ends, ease back to the default layout.
            if let previous = segments.last(where: { $0.end <= t }), t - previous.end < previous.transition {
                let p = Self.ease((t - previous.end) / previous.transition)
                return state(for: previous.layout, canvas: canvas).lerp(to: state(for: .default, canvas: canvas), p)
            }
            return state(for: .default, canvas: canvas)
        }
        let segment = segments[index]
        let current = state(for: segment.layout, canvas: canvas)
        let into = t - segment.start
        guard into < segment.transition else { return current }
        // Blend from whatever came right before: the previous segment if it touches, else default.
        let before: EditSettings.SceneLayout
        if index > 0, abs(segments[index - 1].end - segment.start) < 0.05 {
            before = segments[index - 1].layout
        } else {
            before = .default
        }
        return state(for: before, canvas: canvas).lerp(to: current, Self.ease(into / segment.transition))
    }

    func state(for layout: EditSettings.SceneLayout, canvas: CGRect) -> SceneState {
        let short = min(canvas.width, canvas.height)
        let inset = settings.padding * short
        let available = canvas.insetBy(dx: inset, dy: inset)
        let bubble = bubbleRect(canvas: canvas)
        let bubbleRadius = cameraRadius(for: bubble)
        let cameraVisible = hasCamera && settings.camera.visible ? 1.0 : 0.0

        switch layout {
        case .default:
            return SceneState(screenRect: DeviceFrameGeometry.fit(settings.frame, aspect: screenAspect, in: available),
                              screenAlpha: 1, cameraRect: bubble, cameraRadius: bubbleRadius, cameraAlpha: cameraVisible)
        case .hideCamera:
            return SceneState(screenRect: DeviceFrameGeometry.fit(settings.frame, aspect: screenAspect, in: available),
                              screenAlpha: 1, cameraRect: bubble, cameraRadius: bubbleRadius, cameraAlpha: 0)
        case .cameraOnly:
            let full = available
            let small = DeviceFrameGeometry.fit(settings.frame, aspect: screenAspect, in: available.insetBy(dx: available.width * 0.2, dy: available.height * 0.2))
            return SceneState(screenRect: small, screenAlpha: 0, cameraRect: full,
                              cameraRadius: settings.cornerRadius * min(full.width, full.height) * 1.6, cameraAlpha: hasCamera ? 1 : 0, zoomAllowance: 0)
        case .splitScreen:
            let gap = short * 0.03
            let cameraWidth = available.width * 0.34
            let screenBox = CGRect(x: available.minX, y: available.minY, width: available.width - cameraWidth - gap, height: available.height)
            let screen = DeviceFrameGeometry.fit(settings.frame, aspect: screenAspect, in: screenBox)
            let camera = CGRect(x: available.maxX - cameraWidth, y: screen.minY, width: cameraWidth, height: screen.height)
            return SceneState(screenRect: screen, screenAlpha: 1, cameraRect: camera,
                              cameraRadius: settings.cornerRadius * min(camera.width, camera.height) * 1.6, cameraAlpha: hasCamera ? 1 : 0, zoomAllowance: 0)
        case .floating:
            let screenBox = CGRect(x: available.minX, y: available.minY + available.height * 0.1,
                                   width: available.width * 0.78, height: available.height * 0.9)
            let screen = DeviceFrameGeometry.fit(settings.frame, aspect: screenAspect, in: screenBox)
            let cameraWidth = available.width * 0.3
            let camera = CGRect(x: available.maxX - cameraWidth, y: available.minY, width: cameraWidth, height: cameraWidth * 1.15)
            return SceneState(screenRect: screen, screenAlpha: 1, cameraRect: camera,
                              cameraRadius: cameraWidth * 0.08, cameraAlpha: hasCamera ? 1 : 0, zoomAllowance: 0)
        }
    }

    /// The default camera bubble from the camera settings.
    private func bubbleRect(canvas: CGRect) -> CGRect {
        let d = settings.camera.size * min(canvas.width, canvas.height)
        let center = CGPoint(x: settings.camera.position.x * canvas.width, y: (1 - settings.camera.position.y) * canvas.height)
        return CGRect(x: center.x - d / 2, y: center.y - d / 2, width: d, height: d)
    }

    private func cameraRadius(for rect: CGRect) -> CGFloat {
        switch settings.camera.shape {
        case .circle: rect.width / 2
        case .squircle: rect.width * 0.24
        case .square: rect.width * 0.06
        }
    }

    static func ease(_ x: Double) -> Double {
        let x = min(max(x, 0), 1)
        return x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2
    }
}

/// Proportions of each device frame's chrome, relative to the content (screen) width.
nonisolated enum DeviceFrameGeometry {
    struct Insets { var top, left, right, bottom: CGFloat }

    static func insets(_ frame: EditSettings.DeviceFrame) -> Insets {
        switch frame {
        case .none: Insets(top: 0, left: 0, right: 0, bottom: 0)
        case .macOS: Insets(top: 0.034, left: 0, right: 0, bottom: 0)
        case .windows: Insets(top: 0.032, left: 0, right: 0, bottom: 0)
        case .browser: Insets(top: 0.062, left: 0, right: 0, bottom: 0)
        // Bezel all around, plus the wider base below.
        case .macBook: Insets(top: 0.032, left: 0.09, right: 0.09, bottom: 0.068)
        }
    }

    /// Largest outer rect in `box` whose content keeps `aspect`.
    static func fit(_ frame: EditSettings.DeviceFrame, aspect: Double, in box: CGRect) -> CGRect {
        let i = insets(frame)
        let widthFactor = 1 + i.left + i.right
        let heightFactor = 1 / aspect + i.top + i.bottom
        let contentWidth = min(box.width / widthFactor, box.height / heightFactor)
        let size = CGSize(width: contentWidth * widthFactor, height: contentWidth * heightFactor)
        return CGRect(x: box.midX - size.width / 2, y: box.midY - size.height / 2, width: size.width, height: size.height).integral
    }

    /// The screen content inside an outer frame rect (Core Image coordinates).
    static func contentRect(_ frame: EditSettings.DeviceFrame, outer: CGRect) -> CGRect {
        let i = insets(frame)
        let contentWidth = outer.width / (1 + i.left + i.right)
        return CGRect(x: outer.minX + i.left * contentWidth, y: outer.minY + i.bottom * contentWidth,
                      width: contentWidth, height: outer.height - (i.top + i.bottom) * contentWidth)
    }
}
