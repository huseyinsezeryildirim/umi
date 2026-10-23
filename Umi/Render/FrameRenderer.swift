import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Metal

/// Draws one output frame from the source tracks and the edit settings.
/// The same renderer backs the editor preview and the export, so they always match.
nonisolated final class FrameRenderer: @unchecked Sendable {
    static let context: CIContext = {
        if let device = MTLCreateSystemDefaultDevice() {
            return CIContext(mtlDevice: device, options: [.cacheIntermediates: false])
        }
        return CIContext()
    }()

    let settings: EditSettings
    let project: RecordingProject
    private let cursor: CursorTrack
    private let zoom: ZoomTrack
    private let cursorImage: CursorImage
    private let ringImage: CIImage

    struct CursorImage: @unchecked Sendable {
        var image: CIImage
        /// Size and hot spot in points, top-left origin.
        var size: CGSize
        var hotSpot: CGPoint
    }

    init(project: RecordingProject, cursorData: CursorData, cursorImage: CursorImage) {
        let settings = project.edit ?? EditSettings()
        self.settings = settings
        self.project = project
        self.cursorImage = cursorImage
        cursor = CursorTrack(data: cursorData, duration: project.duration, spring: settings.cursor.smoothing.spring)
        zoom = ZoomTrack(settings: settings.zoom, cursor: cursorData, duration: project.duration)
        ringImage = Self.makeRing()
    }

    var zoomSegments: [EditSettings.ZoomSegment] { zoom.segments }

    func render(screen: CVPixelBuffer?, camera: CVPixelBuffer?, at time: Double, into output: CVPixelBuffer) {
        let size = CGSize(width: CVPixelBufferGetWidth(output), height: CVPixelBufferGetHeight(output))
        let image = compose(screen: screen.map { CIImage(cvPixelBuffer: $0) }, camera: camera.map { CIImage(cvPixelBuffer: $0) }, at: time, size: size)
        Self.context.render(image, to: output, bounds: CGRect(origin: .zero, size: size), colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    }

    func compose(screen: CIImage?, camera: CIImage?, at time: Double, size: CGSize) -> CIImage {
        let canvas = CGRect(origin: .zero, size: size)
        let short = min(size.width, size.height)
        let screenRect = layoutScreen(in: canvas)

        var frame = background(in: canvas)

        if let screen {
            let radius = settings.cornerRadius * min(screenRect.width, screenRect.height)
            let placed = screen
                .transformed(by: CGAffineTransform(scaleX: screenRect.width / screen.extent.width, y: screenRect.height / screen.extent.height))
                .transformed(by: CGAffineTransform(translationX: screenRect.minX, y: screenRect.minY))
            let mask = Self.roundedRect(screenRect, radius: radius, color: .white)

            if settings.shadow > 0 {
                let shadow = Self.roundedRect(screenRect, radius: radius, color: CIColor(red: 0, green: 0, blue: 0, alpha: 0.55 * settings.shadow))
                    .applyingGaussianBlur(sigma: short * 0.025 * settings.shadow)
                    .transformed(by: CGAffineTransform(translationX: 0, y: -short * 0.012))
                    .cropped(to: canvas)
                frame = shadow.composited(over: frame)
            }
            frame = placed.applyingFilter("CIBlendWithMask", parameters: [
                kCIInputBackgroundImageKey: frame,
                kCIInputMaskImageKey: mask,
            ])
        }

        frame = drawCursor(over: frame, screenRect: screenRect, at: time)

        // Zoom the composed screen (not the camera), keeping the view inside the canvas.
        let (scale, focus) = zoom.state(at: time)
        if scale > 1.001 {
            let viewSize = CGSize(width: size.width / scale, height: size.height / scale)
            let center = CGPoint(x: screenRect.minX + focus.x * screenRect.width, y: screenRect.maxY - focus.y * screenRect.height)
            let origin = CGPoint(
                x: min(max(center.x - viewSize.width / 2, 0), size.width - viewSize.width),
                y: min(max(center.y - viewSize.height / 2, 0), size.height - viewSize.height)
            )
            frame = frame
                .transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
                .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }

        if let camera, settings.camera.visible {
            frame = drawCamera(camera, over: frame, canvas: canvas)
        }
        return frame.cropped(to: canvas)
    }

    /// The screen's rectangle inside the canvas, after padding (Core Image coordinates).
    func layoutScreen(in canvas: CGRect) -> CGRect {
        let inset = settings.padding * min(canvas.width, canvas.height)
        let available = canvas.insetBy(dx: inset, dy: inset)
        let aspect = Double(project.screen.pixelWidth) / Double(max(project.screen.pixelHeight, 1))
        var width = available.width, height = width / aspect
        if height > available.height { height = available.height; width = height * aspect }
        return CGRect(x: available.midX - width / 2, y: available.midY - height / 2, width: width, height: height).integral
    }

    // MARK: Layers

    private func background(in canvas: CGRect) -> CIImage {
        switch settings.background {
        case .color(let c):
            return CIImage(color: CIColor(red: c.r, green: c.g, blue: c.b, alpha: c.a)).cropped(to: canvas)
        case .gradient(let preset):
            let (a, b) = preset.colors
            let gradient = CIFilter.linearGradient()
            gradient.point0 = CGPoint(x: canvas.minX, y: canvas.maxY)
            gradient.point1 = CGPoint(x: canvas.maxX, y: canvas.minY)
            gradient.color0 = CIColor(red: a.r, green: a.g, blue: a.b)
            gradient.color1 = CIColor(red: b.r, green: b.g, blue: b.b)
            return (gradient.outputImage ?? CIImage.black).cropped(to: canvas)
        }
    }

    private func drawCursor(over frame: CIImage, screenRect: CGRect, at time: Double) -> CIImage {
        guard settings.cursor.visible, let p = cursor.position(at: time),
              (-0.02...1.02).contains(p.x), (-0.02...1.02).contains(p.y) else { return frame }

        // Points → canvas pixels: the screen rect spans captureRect.width points.
        let pointScale = screenRect.width / max(project.screen.captureRect.width, 1)
        let anchor = CGPoint(x: screenRect.minX + p.x * screenRect.width, y: screenRect.maxY - p.y * screenRect.height)
        var result = frame

        if settings.cursor.clickRings {
            for click in cursor.clicks where time >= click.t && time - click.t < 0.45 {
                let progress = (time - click.t) / 0.45
                let diameter = (24 + 36 * progress) * pointScale * max(settings.cursor.size, 1)
                let ringAnchor = CGPoint(x: screenRect.minX + click.x * screenRect.width, y: screenRect.maxY - click.y * screenRect.height)
                let ring = ringImage
                    .transformed(by: CGAffineTransform(scaleX: diameter / ringImage.extent.width, y: diameter / ringImage.extent.height))
                    .transformed(by: CGAffineTransform(translationX: ringAnchor.x - diameter / 2, y: ringAnchor.y - diameter / 2))
                    .applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0.9 * (1 - progress))])
                result = ring.composited(over: result)
            }
        }

        let scale = pointScale * settings.cursor.size
        let image = cursorImage.image
        let drawn = image
            .transformed(by: CGAffineTransform(scaleX: cursorImage.size.width * scale / image.extent.width, y: cursorImage.size.height * scale / image.extent.height))
            .transformed(by: CGAffineTransform(
                translationX: anchor.x - cursorImage.hotSpot.x * scale,
                y: anchor.y - (cursorImage.size.height - cursorImage.hotSpot.y) * scale
            ))
        return drawn.composited(over: result)
    }

    private func drawCamera(_ camera: CIImage, over frame: CIImage, canvas: CGRect) -> CIImage {
        let diameter = settings.camera.size * min(canvas.width, canvas.height)
        let side = min(camera.extent.width, camera.extent.height)
        var image = camera.cropped(to: CGRect(x: camera.extent.midX - side / 2, y: camera.extent.midY - side / 2, width: side, height: side))
            .transformed(by: CGAffineTransform(translationX: -(camera.extent.midX - side / 2), y: -(camera.extent.midY - side / 2)))
        if settings.camera.mirrored {
            image = image.transformed(by: CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -side, y: 0))
        }
        let center = CGPoint(x: settings.camera.position.x * canvas.width, y: (1 - settings.camera.position.y) * canvas.height)
        let rect = CGRect(x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter)
        image = image
            .transformed(by: CGAffineTransform(scaleX: diameter / side, y: diameter / side))
            .transformed(by: CGAffineTransform(translationX: rect.minX, y: rect.minY))

        let radius: CGFloat = switch settings.camera.shape {
        case .circle: diameter / 2
        case .squircle: diameter * 0.24
        case .square: diameter * 0.06
        }
        let shadow = Self.roundedRect(rect, radius: radius, color: CIColor(red: 0, green: 0, blue: 0, alpha: 0.4))
            .applyingGaussianBlur(sigma: diameter * 0.04)
            .transformed(by: CGAffineTransform(translationX: 0, y: -diameter * 0.02))
        let masked = image.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: shadow.composited(over: frame),
            kCIInputMaskImageKey: Self.roundedRect(rect, radius: radius, color: .white),
        ])
        return masked
    }

    // MARK: Helpers

    private static func roundedRect(_ rect: CGRect, radius: CGFloat, color: CIColor) -> CIImage {
        let filter = CIFilter.roundedRectangleGenerator()
        filter.extent = rect
        filter.radius = Float(radius)
        filter.color = color
        return filter.outputImage ?? CIImage.empty()
    }

    private static func makeRing() -> CIImage {
        let side = 256
        guard let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return CIImage.empty() }
        context.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.setLineWidth(18)
        context.strokeEllipse(in: CGRect(x: 12, y: 12, width: side - 24, height: side - 24))
        context.setStrokeColor(CGColor(red: 0, green: 0, blue: 0, alpha: 0.25))
        context.setLineWidth(4)
        context.strokeEllipse(in: CGRect(x: 2, y: 2, width: side - 4, height: side - 4))
        return context.makeImage().map { CIImage(cgImage: $0) } ?? CIImage.empty()
    }
}

extension FrameRenderer.CursorImage {
    /// The standard arrow cursor. Must be called on the main thread (AppKit).
    @MainActor static var arrow: Self {
        let cursor = NSCursor.arrow
        let image = cursor.image
        var rect = CGRect(origin: .zero, size: CGSize(width: image.size.width * 4, height: image.size.height * 4))
        let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
        return Self(image: cg.map { CIImage(cgImage: $0) } ?? CIImage.empty(), size: image.size, hotSpot: cursor.hotSpot)
    }
}
