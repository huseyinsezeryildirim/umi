import CoreGraphics
import CoreImage
import os

/// Draws device chrome (window title bars, browser bar, MacBook bezel and base) around
/// the screen. The content area is left for the screen; images are cached per size.
nonisolated final class DeviceFrameRenderer: @unchecked Sendable {
    private let cache = OSAllocatedUnfairLock(initialState: [String: CIImage]())

    /// Chrome image positioned at `outer`, and the corner radius for the content inside it.
    func chrome(_ frame: EditSettings.DeviceFrame, outer: CGRect) -> (image: CIImage?, contentRadius: CGFloat?) {
        guard frame != .none else { return (nil, nil) }
        let content = DeviceFrameGeometry.contentRect(frame, outer: outer)
        let cw = content.width
        let radius: CGFloat = switch frame {
        case .macOS, .browser: cw * 0.012
        case .windows: cw * 0.004
        case .macBook: cw * 0.004
        case .none: 0
        }
        let key = "\(frame.rawValue)-\(Int(outer.width))x\(Int(outer.height))"
        if let cached = cache.withLock({ $0[key] }) {
            return (cached.transformed(by: CGAffineTransform(translationX: outer.minX, y: outer.minY)), radius)
        }
        guard let image = draw(frame, size: outer.size, content: content.offsetBy(dx: -outer.minX, dy: -outer.minY)) else { return (nil, radius) }
        let ci = CIImage(cgImage: image)
        cache.withLock { $0[key] = ci }
        return (ci.transformed(by: CGAffineTransform(translationX: outer.minX, y: outer.minY)), radius)
    }

    private func draw(_ frame: EditSettings.DeviceFrame, size: CGSize, content: CGRect) -> CGImage? {
        let width = Int(size.width.rounded()), height = Int(size.height.rounded())
        guard width > 0, height > 0,
              let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        let bounds = CGRect(origin: .zero, size: size)
        let cw = content.width
        let titleBar = CGRect(x: content.minX, y: content.maxY, width: content.width, height: bounds.maxY - content.maxY)

        func fill(_ path: CGPath, _ color: CGColor) { ctx.addPath(path); ctx.setFillColor(color); ctx.fillPath() }
        func gray(_ v: CGFloat, _ a: CGFloat = 1) -> CGColor { CGColor(gray: v, alpha: a) }

        switch frame {
        case .none:
            return nil

        case .macOS, .browser:
            let radius = cw * 0.012
            fill(CGPath(roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil), gray(0.96))
            // Title bar separator.
            ctx.setFillColor(gray(0.84))
            ctx.fill(CGRect(x: 0, y: content.maxY, width: bounds.width, height: max(1, cw * 0.0008)))
            // Traffic lights.
            let d = cw * 0.0105, gap = d * 0.75
            let cy = frame == .browser ? content.maxY + titleBar.height * 0.5 : titleBar.midY
            for (i, color) in [CGColor(red: 1, green: 0.37, blue: 0.34, alpha: 1), CGColor(red: 1, green: 0.74, blue: 0.18, alpha: 1),
                               CGColor(red: 0.16, green: 0.79, blue: 0.25, alpha: 1)].enumerated() {
                ctx.setFillColor(color)
                ctx.fillEllipse(in: CGRect(x: cw * 0.014 + CGFloat(i) * (d + gap), y: cy - d / 2, width: d, height: d))
            }
            if frame == .browser {
                // Address bar pill with a lock and a faint URL line.
                let pill = CGRect(x: bounds.midX - cw * 0.22, y: cy - titleBar.height * 0.27, width: cw * 0.44, height: titleBar.height * 0.54)
                fill(CGPath(roundedRect: pill, cornerWidth: pill.height / 2, cornerHeight: pill.height / 2, transform: nil), gray(1))
                ctx.setStrokeColor(gray(0.82)); ctx.setLineWidth(max(1, cw * 0.0007))
                ctx.addPath(CGPath(roundedRect: pill, cornerWidth: pill.height / 2, cornerHeight: pill.height / 2, transform: nil)); ctx.strokePath()
                ctx.setFillColor(gray(0.55))
                let lock = pill.height * 0.32
                ctx.fill(CGRect(x: pill.minX + pill.height * 0.5, y: pill.midY - lock / 2, width: lock * 0.8, height: lock * 0.7))
                fill(CGPath(roundedRect: CGRect(x: pill.minX + pill.height * 1.1, y: pill.midY - pill.height * 0.09, width: pill.width * 0.32, height: pill.height * 0.18),
                            cornerWidth: pill.height * 0.09, cornerHeight: pill.height * 0.09, transform: nil), gray(0.78))
            }

        case .windows:
            let radius = cw * 0.004
            fill(CGPath(roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil), gray(0.98))
            ctx.setFillColor(gray(0.86))
            ctx.fill(CGRect(x: 0, y: content.maxY, width: bounds.width, height: max(1, cw * 0.0008)))
            // Minimize, maximize, close glyphs on the right.
            let g = titleBar.height * 0.3, cy = titleBar.midY, step = titleBar.height * 1.45
            ctx.setStrokeColor(gray(0.25)); ctx.setLineWidth(max(1, cw * 0.0008))
            var x = bounds.maxX - step * 2.5
            ctx.move(to: CGPoint(x: x - g / 2, y: cy)); ctx.addLine(to: CGPoint(x: x + g / 2, y: cy)); ctx.strokePath()
            x += step
            ctx.stroke(CGRect(x: x - g / 2, y: cy - g / 2, width: g, height: g))
            x += step
            ctx.move(to: CGPoint(x: x - g / 2, y: cy - g / 2)); ctx.addLine(to: CGPoint(x: x + g / 2, y: cy + g / 2))
            ctx.move(to: CGPoint(x: x - g / 2, y: cy + g / 2)); ctx.addLine(to: CGPoint(x: x + g / 2, y: cy - g / 2)); ctx.strokePath()

        case .macBook:
            // Lid: black bezel with rounded top corners around the content.
            let bezel = cw * 0.032
            let lid = CGRect(x: content.minX - bezel, y: content.minY - bezel, width: content.width + bezel * 2, height: content.height + bezel * 2)
            let lidRadius = cw * 0.03
            fill(CGPath(roundedRect: lid, cornerWidth: lidRadius, cornerHeight: lidRadius, transform: nil), gray(0.08))
            ctx.setStrokeColor(gray(0.35)); ctx.setLineWidth(max(1, cw * 0.0012))
            ctx.addPath(CGPath(roundedRect: lid.insetBy(dx: 1, dy: 1), cornerWidth: lidRadius, cornerHeight: lidRadius, transform: nil)); ctx.strokePath()
            // Base: a wider aluminium slab with a thumb notch.
            let baseHeight = lid.minY
            let base = CGRect(x: 0, y: 0, width: bounds.width, height: baseHeight)
            let basePath = CGPath(roundedRect: base, cornerWidth: baseHeight * 0.45, cornerHeight: baseHeight * 0.45, transform: nil)
            ctx.saveGState()
            ctx.addPath(basePath); ctx.clip()
            let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [gray(0.62), gray(0.86), gray(0.78)] as CFArray, locations: [0, 0.6, 1])!
            ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: baseHeight), options: [])
            ctx.restoreGState()
            let notch = CGRect(x: bounds.midX - cw * 0.08, y: baseHeight * 0.55, width: cw * 0.16, height: baseHeight * 0.45)
            fill(CGPath(roundedRect: notch, cornerWidth: notch.height * 0.5, cornerHeight: notch.height * 0.5, transform: nil), gray(0.6))
        }

        // Leave the content area empty; the screen is composited there.
        ctx.setBlendMode(.clear)
        ctx.fill(content)
        return ctx.makeImage()
    }
}
