import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import ImageIO
import Metal

/// Draws one output frame from the source tracks and the edit settings.
/// The same renderer backs the editor preview and the export, so they always match.
///
/// Layer order: background → screen card (masks, device frame, shadow, cursor) with its
/// 3D move → zoom → camera → color grade → text overlays → captions.
nonisolated final class FrameRenderer: @unchecked Sendable {
    static let context: CIContext = {
        if let device = MTLCreateSystemDefaultDevice() {
            return CIContext(mtlDevice: device, options: [.cacheIntermediates: false])
        }
        return CIContext()
    }()

    let settings: EditSettings
    let project: RecordingProject
    /// The editor turns these off while you place masks or a zoom focus on the preview,
    /// so what you see lines up with the overlay handles.
    let applyZoomAndMoves: Bool
    private let bundle: URL?
    private let cursor: CursorTrack
    private let zoom: ZoomTrack
    private let scenes: SceneLayoutEngine
    private let cursorImage: CursorImage
    private let ringImage: CIImage
    private let frames = DeviceFrameRenderer()
    private let text = TextRenderer()
    private let backgroundImage: CIImage?

    struct CursorImage: @unchecked Sendable {
        var image: CIImage
        /// Size and hot spot in points, top-left origin.
        var size: CGSize
        var hotSpot: CGPoint
    }

    init(project: RecordingProject, cursorData: CursorData, cursorImage: CursorImage, bundle: URL? = nil, applyZoomAndMoves: Bool = true) {
        let settings = project.edit ?? EditSettings()
        self.settings = settings
        self.project = project
        self.bundle = bundle
        self.applyZoomAndMoves = applyZoomAndMoves
        self.cursorImage = cursorImage
        cursor = CursorTrack(data: cursorData, duration: project.duration, spring: settings.cursor.smoothing.spring)
        zoom = ZoomTrack(settings: settings.zoom, cursor: cursorData, duration: project.duration)
        scenes = SceneLayoutEngine(settings: settings,
                                   screenAspect: Double(project.screen.pixelWidth) / Double(max(project.screen.pixelHeight, 1)),
                                   hasCamera: project.camera != nil)
        ringImage = Self.makeRing()
        backgroundImage = Self.loadBackgroundImage(settings.background, bundle: bundle)
    }

    var zoomSegments: [EditSettings.ZoomSegment] { zoom.segments }

    func render(screen: CVPixelBuffer?, camera: CVPixelBuffer?, at time: Double, into output: CVPixelBuffer) {
        let size = CGSize(width: CVPixelBufferGetWidth(output), height: CVPixelBufferGetHeight(output))
        let image = compose(screen: screen.map { CIImage(cvPixelBuffer: $0) }, camera: camera.map { CIImage(cvPixelBuffer: $0) }, at: time, size: size)
        Self.context.render(image, to: output, bounds: CGRect(origin: .zero, size: size), colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    }

    /// Two moments dissolved together (crossfade between clips).
    func renderDissolve(from a: (screen: CVPixelBuffer?, camera: CVPixelBuffer?, time: Double),
                        to b: (screen: CVPixelBuffer?, camera: CVPixelBuffer?, time: Double),
                        progress: Double, into output: CVPixelBuffer) {
        let size = CGSize(width: CVPixelBufferGetWidth(output), height: CVPixelBufferGetHeight(output))
        let first = compose(screen: a.screen.map { CIImage(cvPixelBuffer: $0) }, camera: a.camera.map { CIImage(cvPixelBuffer: $0) }, at: a.time, size: size)
        let second = compose(screen: b.screen.map { CIImage(cvPixelBuffer: $0) }, camera: b.camera.map { CIImage(cvPixelBuffer: $0) }, at: b.time, size: size)
        let mixed = first.applyingFilter("CIDissolveTransition", parameters: [kCIInputTargetImageKey: second, kCIInputTimeKey: progress])
        Self.context.render(mixed, to: output, bounds: CGRect(origin: .zero, size: size), colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    }

    func compose(screen: CIImage?, camera: CIImage?, at time: Double, size: CGSize) -> CIImage {
        let canvas = CGRect(origin: .zero, size: size)
        let short = min(size.width, size.height)
        let scene = scenes.state(at: time, canvas: canvas)
        let move = applyZoomAndMoves ? Effects.movePose(settings.moves, at: time, canvas: canvas) : nil

        var frame = background(in: canvas, time: time)
        if let move, move.amount > 0 {
            // Shallow focus: the background softens while the card moves in 3D.
            frame = frame.clampedToExtent().applyingGaussianBlur(sigma: short * 0.006 * move.amount).cropped(to: canvas)
        }

        // Screen card, built on a transparent layer so a 3D move can tilt it as a whole.
        if let screen, scene.screenAlpha > 0.001 {
            var card = screenCard(Effects.applyMasks(settings.masks, to: screen, at: time), outer: scene.screenRect, canvas: canvas, time: time)
            if let move {
                card = Effects.perspective(card, rect: scene.screenRect, yaw: move.yaw, pitch: move.pitch, scale: move.scale, shift: move.shift)
            }
            if scene.screenAlpha < 0.999 { card = card.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: scene.screenAlpha)]) }
            frame = card.composited(over: frame)
        }

        // Zoom the composed screen (not the camera), keeping the view inside the canvas.
        let (scale, focus) = applyZoomAndMoves ? zoom.state(at: time) : (1, CGPoint(x: 0.5, y: 0.5))
        if scale > 1.001 {
            let content = DeviceFrameGeometry.contentRect(settings.frame, outer: scene.screenRect)
            let viewSize = CGSize(width: size.width / scale, height: size.height / scale)
            let center = CGPoint(x: content.minX + focus.x * content.width, y: content.maxY - focus.y * content.height)
            let origin = CGPoint(
                x: min(max(center.x - viewSize.width / 2, 0), size.width - viewSize.width),
                y: min(max(center.y - viewSize.height / 2, 0), size.height - viewSize.height)
            )
            frame = frame
                .transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
                .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                .cropped(to: canvas)
        }

        if let camera, scene.cameraAlpha > 0.001 {
            frame = drawCamera(camera, over: frame, rect: scene.cameraRect, radius: scene.cameraRadius, alpha: scene.cameraAlpha)
        }

        frame = Effects.grade(frame.cropped(to: canvas), settings.grade, canvas: canvas, time: time)

        for overlay in settings.texts {
            if let image = text.overlay(overlay, at: time, canvas: canvas) { frame = image.composited(over: frame) }
        }
        if let caption = text.caption(settings.captions, at: time, canvas: canvas, accent: CGColor(red: 0.067, green: 0.435, blue: 0.96, alpha: 1)) {
            frame = caption.composited(over: frame)
        }
        return frame.cropped(to: canvas)
    }

    /// The screen content rect at `time` (Core Image coordinates), e.g. for editor overlays.
    func screenContentRect(at time: Double, canvas: CGRect) -> CGRect {
        DeviceFrameGeometry.contentRect(settings.frame, outer: scenes.state(at: time, canvas: canvas).screenRect)
    }

    // MARK: Layers

    /// Shadow, device chrome, the screen with rounded corners, and the cursor.
    private func screenCard(_ screen: CIImage, outer: CGRect, canvas: CGRect, time: Double) -> CIImage {
        let short = min(canvas.width, canvas.height)
        let content = DeviceFrameGeometry.contentRect(settings.frame, outer: outer)
        let (chrome, chromeRadius) = frames.chrome(settings.frame, outer: outer)
        let radius = chromeRadius ?? settings.cornerRadius * min(content.width, content.height)

        var card = CIImage.empty()
        if settings.shadow > 0 {
            // The MacBook's shadow follows the lid and base; others follow the card.
            let shadowRect = outer
            let shadowRadius = settings.frame == .none ? radius : min(outer.width, outer.height) * 0.02
            card = Effects.roundedRect(shadowRect, radius: shadowRadius, alpha: 1)
                .applyingFilter("CIColorMatrix", parameters: [
                    "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0),
                    "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0.55 * settings.shadow),
                ])
                .applyingGaussianBlur(sigma: short * 0.025 * settings.shadow)
                .transformed(by: CGAffineTransform(translationX: 0, y: -short * 0.012))
        }
        if let chrome { card = chrome.composited(over: card) }

        let placed = screen
            .transformed(by: CGAffineTransform(scaleX: content.width / screen.extent.width, y: content.height / screen.extent.height))
            .transformed(by: CGAffineTransform(translationX: content.minX - screen.extent.minX * content.width / screen.extent.width,
                                               y: content.minY - screen.extent.minY * content.height / screen.extent.height))
        card = Effects.blend(placed, over: card, mask: Effects.roundedRect(content, radius: radius, alpha: 1))
        return drawCursor(over: card, screenRect: content, at: time).cropped(to: canvas.insetBy(dx: -short, dy: -short))
    }

    private func background(in canvas: CGRect, time: Double) -> CIImage {
        var image: CIImage
        switch settings.background {
        case .color(let c):
            image = CIImage(color: CIColor(red: c.r, green: c.g, blue: c.b, alpha: c.a)).cropped(to: canvas)
        case .gradient(let preset):
            let (a, b) = preset.colors
            let angle = settings.backgroundAngle * .pi / 180
            let half = hypot(canvas.width, canvas.height) / 2
            let dx = CGFloat(cos(angle)) * half, dy = CGFloat(sin(angle)) * half
            let gradient = CIFilter.linearGradient()
            gradient.point0 = CGPoint(x: canvas.midX - dx, y: canvas.midY - dy)
            gradient.point1 = CGPoint(x: canvas.midX + dx, y: canvas.midY + dy)
            gradient.color0 = CIColor(red: a.r, green: a.g, blue: a.b)
            gradient.color1 = CIColor(red: b.r, green: b.g, blue: b.b)
            image = (gradient.outputImage ?? CIImage.black).cropped(to: canvas)
        case .image:
            if let backgroundImage {
                // Aspect-fill the canvas.
                let s = max(canvas.width / backgroundImage.extent.width, canvas.height / backgroundImage.extent.height)
                let scaled = backgroundImage.transformed(by: CGAffineTransform(scaleX: s, y: s))
                image = scaled.transformed(by: CGAffineTransform(translationX: canvas.midX - scaled.extent.midX, y: canvas.midY - scaled.extent.midY))
                    .cropped(to: canvas)
            } else {
                image = CIImage(color: CIColor(red: 0.2, green: 0.22, blue: 0.27)).cropped(to: canvas)
            }
        }
        if settings.backgroundNoise > 0 {
            image = Effects.grain(over: image, amount: settings.backgroundNoise, canvas: canvas, seed: 0)
        }
        return image
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

    /// The camera cropped to fill `rect` (any aspect), with rounded corners and a shadow.
    private func drawCamera(_ camera: CIImage, over frame: CIImage, rect: CGRect, radius: CGFloat, alpha: Double) -> CIImage {
        let ext = camera.extent
        let targetAspect = rect.width / max(rect.height, 1)
        var crop = ext
        if ext.width / ext.height > targetAspect {
            crop.size.width = ext.height * targetAspect
            crop.origin.x = ext.midX - crop.width / 2
        } else {
            crop.size.height = ext.width / targetAspect
            crop.origin.y = ext.midY - crop.height / 2
        }
        var image = camera.cropped(to: crop).transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
        if settings.camera.mirrored {
            image = image.transformed(by: CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -crop.width, y: 0))
        }
        image = image
            .transformed(by: CGAffineTransform(scaleX: rect.width / crop.width, y: rect.height / crop.height))
            .transformed(by: CGAffineTransform(translationX: rect.minX, y: rect.minY))

        let size = min(rect.width, rect.height)
        let shadow = Effects.roundedRect(rect, radius: radius, alpha: 1)
            .applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0),
                "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0.4 * alpha),
            ])
            .applyingGaussianBlur(sigma: size * 0.04)
            .transformed(by: CGAffineTransform(translationX: 0, y: -size * 0.02))
        return Effects.blend(image, over: shadow.composited(over: frame), mask: Effects.roundedRect(rect, radius: radius, alpha: alpha))
    }

    // MARK: Helpers

    private static func loadBackgroundImage(_ background: EditSettings.Background, bundle: URL?) -> CIImage? {
        guard case .image(let path) = background else { return nil }
        let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : bundle?.appendingPathComponent(path)
        guard let url, let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        // Downsample big wallpapers; 2560 px is plenty for 4K output with padding.
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 3200,
                                        kCGImageSourceCreateThumbnailWithTransform: true]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return CIImage(cgImage: image)
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
