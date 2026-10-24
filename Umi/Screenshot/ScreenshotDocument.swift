import AppKit
import CoreImage
import Observation
import ScreenCaptureKit

/// One annotation on a screenshot, in canvas-normalized coordinates (top-left origin).
struct Annotation: Identifiable, Hashable {
    enum Kind: String, CaseIterable, Hashable {
        case arrow, box, text, highlight, blur

        var icon: String {
            switch self {
            case .arrow: "arrow.up.right"
            case .box: "rectangle"
            case .text: "textformat"
            case .highlight: "highlighter"
            case .blur: "eye.slash"
            }
        }
    }

    var id = UUID()
    var kind: Kind
    var from: CGPoint
    var to: CGPoint
    var text = "Text"
    var color = AnnotationColor.red

    var rect: CGRect {
        CGRect(x: min(from.x, to.x), y: min(from.y, to.y), width: abs(to.x - from.x), height: abs(to.y - from.y))
    }
}

enum AnnotationColor: String, CaseIterable, Hashable {
    case red, yellow, blue, green, ink, white

    var cgColor: CGColor {
        switch self {
        case .red: CGColor(red: 0.94, green: 0.27, blue: 0.23, alpha: 1)
        case .yellow: CGColor(red: 1, green: 0.78, blue: 0.24, alpha: 1)
        case .blue: CGColor(red: 0.07, green: 0.44, blue: 0.96, alpha: 1)
        case .green: CGColor(red: 0.05, green: 0.65, blue: 0.47, alpha: 1)
        case .ink: CGColor(red: 0.05, green: 0.07, blue: 0.12, alpha: 1)
        case .white: CGColor(gray: 1, alpha: 1)
        }
    }
}

/// A captured still being beautified and annotated.
@Observable
final class ScreenshotDocument {
    let image: CGImage
    /// The look (background, padding, corners, shadow, frame, aspect), shared with videos.
    var style: EditSettings
    var annotations: [Annotation] = []
    var tool: Annotation.Kind = .arrow
    var color: AnnotationColor = .red
    var selected: UUID?

    init(image: CGImage) {
        self.image = image
        var style = EditSettings()
        StylePresets.defaultPreset?.apply(to: &style)
        style.cursor.visible = false
        style.zoom.auto = false
        self.style = style
    }

    /// Output size: up to the screenshot's own resolution, in the chosen aspect.
    var canvasSize: CGSize {
        CompositionBuilder.renderSize(for: makeProject(style), maxHeight: min(image.height, 2160))
    }

    /// A stand-in recording so the video renderer can dress the still. Blur annotations
    /// become privacy masks on the screen image.
    private var project: RecordingProject {
        var style = style
        style.masks = annotations.filter { $0.kind == .blur }.compactMap { a in
            screenRect(forCanvas: a.rect).map { EditSettings.PrivacyMask(start: 0, end: 1, rect: $0, style: .blur, amount: 0.8) }
        }
        return makeProject(style)
    }

    private func makeProject(_ style: EditSettings) -> RecordingProject {
        var project = RecordingProject(createdAt: .now, duration: 1,
                                       screen: .init(pixelWidth: image.width, pixelHeight: image.height,
                                                     captureRect: CGRect(x: 0, y: 0, width: image.width, height: image.height), fps: 30),
                                       audio: .init())
        project.edit = style
        return project
    }

    private var renderer: FrameRenderer {
        FrameRenderer(project: project, cursorData: CursorData(), cursorImage: FrameRenderer.CursorImage(image: .empty(), size: .zero, hotSpot: .zero))
    }

    /// The dressed screenshot without annotations (blur masks included).
    func renderBase(maxSide: CGFloat? = nil) -> CGImage? {
        var size = canvasSize
        if let maxSide, max(size.width, size.height) > maxSide {
            let s = maxSide / max(size.width, size.height)
            size = CGSize(width: (size.width * s).rounded(), height: (size.height * s).rounded())
        }
        let ci = renderer.compose(screen: CIImage(cgImage: image), camera: nil, at: 0.5, size: size)
        return FrameRenderer.context.createCGImage(ci, from: CGRect(origin: .zero, size: size), format: .RGBA8,
                                                   colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    }

    /// The finished image: dressed screenshot plus arrows, boxes, text and highlights.
    func renderFinal() -> CGImage? {
        guard let base = renderBase() else { return nil }
        let w = base.width, h = base.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        ctx.draw(base, in: CGRect(x: 0, y: 0, width: w, height: h))
        // Flip to top-left coordinates like the editor.
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: 1, y: -1)
        let size = CGSize(width: w, height: h)
        for a in annotations where a.kind != .blur {
            AnnotationPainter.draw(a, in: ctx, size: size)
        }
        return ctx.makeImage()
    }

    /// Canvas-normalized rect → screen-normalized rect (for blur masks), using the layout.
    private func screenRect(forCanvas r: CGRect) -> CGRect? {
        var plain = style
        plain.masks = []
        let project = makeProject(plain)
        let size = CompositionBuilder.renderSize(for: project, maxHeight: min(image.height, 2160))
        let content = FrameRenderer(project: project, cursorData: CursorData(),
                                    cursorImage: FrameRenderer.CursorImage(image: .empty(), size: .zero, hotSpot: .zero))
            .screenContentRect(at: 0.5, canvas: CGRect(origin: .zero, size: size))
        // Content rect is bottom-left based; convert to top-left normalized.
        let cx = content.minX / size.width, cy = 1 - content.maxY / size.height
        let cw = content.width / size.width, ch = content.height / size.height
        let mapped = CGRect(x: (r.minX - cx) / cw, y: (r.minY - cy) / ch, width: r.width / cw, height: r.height / ch)
        let clipped = mapped.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        return clipped.isNull || clipped.isEmpty ? nil : clipped
    }

    // MARK: Output

    func copyToClipboard() {
        guard let image = renderFinal() else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.writeObjects([NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))])
    }

    func save() throws -> URL {
        guard let image = renderFinal(), let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let folder = try RecordingsLibrary.folderURL().appendingPathComponent("Screenshots", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let url = folder.appendingPathComponent("Umi Screenshot \(formatter.string(from: Date())).png")
        try data.write(to: url)
        return url
    }
}

/// Draws annotations with Core Graphics (top-left coordinates), shared by the editor
/// preview and the final image so they match.
enum AnnotationPainter {
    static func draw(_ a: Annotation, in ctx: CGContext, size: CGSize) {
        let p1 = CGPoint(x: a.from.x * size.width, y: a.from.y * size.height)
        let p2 = CGPoint(x: a.to.x * size.width, y: a.to.y * size.height)
        let r = CGRect(x: a.rect.minX * size.width, y: a.rect.minY * size.height, width: a.rect.width * size.width, height: a.rect.height * size.height)
        let line = max(3, min(size.width, size.height) * 0.006)
        ctx.saveGState()
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        switch a.kind {
        case .arrow:
            ctx.setStrokeColor(a.color.cgColor)
            ctx.setFillColor(a.color.cgColor)
            ctx.setShadow(offset: CGSize(width: 0, height: line * 0.4), blur: line, color: CGColor(gray: 0, alpha: 0.35))
            ctx.setLineWidth(line)
            let angle = atan2(p2.y - p1.y, p2.x - p1.x)
            let head = line * 4.5
            let shaftEnd = CGPoint(x: p2.x - cos(angle) * head * 0.8, y: p2.y - sin(angle) * head * 0.8)
            ctx.move(to: p1); ctx.addLine(to: shaftEnd); ctx.strokePath()
            ctx.move(to: p2)
            ctx.addLine(to: CGPoint(x: p2.x - cos(angle - 0.45) * head, y: p2.y - sin(angle - 0.45) * head))
            ctx.addLine(to: CGPoint(x: p2.x - cos(angle + 0.45) * head, y: p2.y - sin(angle + 0.45) * head))
            ctx.closePath(); ctx.fillPath()
        case .box:
            ctx.setStrokeColor(a.color.cgColor)
            ctx.setShadow(offset: CGSize(width: 0, height: line * 0.4), blur: line, color: CGColor(gray: 0, alpha: 0.3))
            ctx.setLineWidth(line)
            ctx.addPath(CGPath(roundedRect: r, cornerWidth: line * 2, cornerHeight: line * 2, transform: nil))
            ctx.strokePath()
        case .highlight:
            ctx.setFillColor(a.color.cgColor.copy(alpha: 0.35)!)
            ctx.setBlendMode(.multiply)
            ctx.fill(r)
        case .text:
            let fontSize = max(14, min(size.width, size.height) * 0.035)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: fontSize, weight: .bold),
                .foregroundColor: NSColor(cgColor: a.color.cgColor) ?? .red,
            ]
            let string = NSAttributedString(string: a.text, attributes: attributes)
            let line = CTLineCreateWithAttributedString(string)
            ctx.setShadow(offset: CGSize(width: 0, height: 1), blur: fontSize * 0.2, color: CGColor(gray: 0, alpha: 0.4))
            // Undo the flip locally so text isn't upside down.
            ctx.translateBy(x: p1.x, y: p1.y + fontSize)
            ctx.scaleBy(x: 1, y: -1)
            ctx.textPosition = .zero
            CTLineDraw(line, ctx)
        case .blur:
            break // rendered as a privacy mask on the screen image
        }
        ctx.restoreGState()
    }
}

/// Grabs part of the screen as an image (without Umi's own windows).
enum ScreenshotCapture {
    /// - Parameter rect: global screen points, top-left origin.
    static func capture(_ rect: CGRect) async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { CGDisplayBounds($0.displayID).intersects(rect) }) else { throw RecorderError.noSource }
        let pid = ProcessInfo.processInfo.processIdentifier
        let own = content.applications.filter { $0.processID == pid }
        let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
        let bounds = CGDisplayBounds(display.displayID)
        let local = rect.intersection(bounds).offsetBy(dx: -bounds.minX, dy: -bounds.minY)
        let config = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        config.sourceRect = local
        config.width = Int(local.width * scale)
        config.height = Int(local.height * scale)
        config.showsCursor = false
        config.colorSpaceName = CGColorSpace.sRGB
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }
}
