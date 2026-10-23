import CoreGraphics
import CoreImage
import CoreText
import Foundation
import os

/// Renders text overlays (titles, lower thirds, stats, quotes, typewriter) and burned-in
/// captions with CoreText, so it's safe on the compositor's threads. Images are cached.
nonisolated final class TextRenderer: @unchecked Sendable {
    private let cache = OSAllocatedUnfairLock(initialState: [String: CIImage]())

    // MARK: Overlays

    func overlay(_ text: EditSettings.TextOverlay, at t: Double, canvas: CGRect) -> CIImage? {
        guard t >= text.start, t <= text.end else { return nil }
        let inDuration = 0.35, outDuration = 0.3
        let pIn = SceneLayoutEngine.ease((t - text.start) / inDuration)
        let pOut = SceneLayoutEngine.ease((text.end - t) / outDuration)
        let visible = min(pIn, pOut)

        // Typewriter reveals characters over up to 1.2 s.
        var characters = text.text.count
        if text.animation == .typewriter || text.style == .typewriter {
            let typing = min(1.2, (text.end - text.start) / 2)
            characters = Int((Double(text.text.count) * min((t - text.start) / max(typing, 0.01), 1)).rounded(.down))
        }
        guard let image = card(for: text, characters: characters, canvas: canvas) else { return nil }

        let anchor = CGPoint(x: text.position.x * canvas.width, y: (1 - text.position.y) * canvas.height)
        var placed = image.transformed(by: CGAffineTransform(translationX: anchor.x - image.extent.width / 2, y: anchor.y - image.extent.height / 2))
        switch text.animation {
        case .slide:
            placed = placed.transformed(by: CGAffineTransform(translationX: 0, y: -(1 - visible) * canvas.height * 0.04))
        case .pop:
            let s = 0.82 + 0.18 * visible
            placed = placed.transformed(by: CGAffineTransform(translationX: -anchor.x, y: -anchor.y)
                .concatenating(CGAffineTransform(scaleX: s, y: s))
                .concatenating(CGAffineTransform(translationX: anchor.x, y: anchor.y)))
        case .fade, .typewriter:
            break
        }
        return placed.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: visible)])
    }

    private func card(for text: EditSettings.TextOverlay, characters: Int, canvas: CGRect) -> CIImage? {
        let key = "\(text.id)-\(text.style.rawValue)-\(text.text.hashValue)-\(text.detail.hashValue)-\(characters)-\(Int(canvas.height))"
        if let cached = cache.withLock({ $0[key] }) { return cached }
        let h = canvas.height
        let shown = String(text.text.prefix(characters))
        let white = CGColor(gray: 1, alpha: 1), ink = CGColor(red: 0.055, green: 0.067, blue: 0.118, alpha: 1)
        let image: CGImage?

        switch text.style {
        case .title:
            image = Self.render(lines: [(shown, Self.font(h * 0.075, weight: .bold), white, -0.02)], padding: CGSize(width: 0, height: 0),
                                background: nil, shadow: true)
        case .lowerThird:
            image = Self.render(lines: [(shown, Self.font(h * 0.036, weight: .semibold), white, 0),
                                        (text.detail, Self.font(h * 0.024, weight: .regular), CGColor(gray: 1, alpha: 0.75), 0)],
                                padding: CGSize(width: h * 0.03, height: h * 0.02),
                                background: CGColor(red: 0.055, green: 0.067, blue: 0.118, alpha: 0.82), accentBar: true, alignLeft: true)
        case .kicker:
            image = Self.render(lines: [(shown.uppercased(), Self.font(h * 0.024, weight: .bold), ink, 0.25)],
                                padding: CGSize(width: h * 0.022, height: h * 0.012), background: CGColor(gray: 1, alpha: 0.95), capsule: true)
        case .bigStat:
            image = Self.render(lines: [(shown, Self.font(h * 0.14, weight: .heavy), white, -0.03),
                                        (text.detail, Self.font(h * 0.028, weight: .medium), CGColor(gray: 1, alpha: 0.85), 0)],
                                padding: .zero, background: nil, shadow: true)
        case .quote:
            image = Self.render(lines: [("“\(shown)”", Self.font(h * 0.05, weight: .regular, serifItalic: true), white, 0),
                                        (text.detail.isEmpty ? "" : "— \(text.detail)", Self.font(h * 0.026, weight: .medium), CGColor(gray: 1, alpha: 0.8), 0)],
                                padding: .zero, background: nil, shadow: true)
        case .typewriter:
            image = Self.render(lines: [(shown + (characters < text.text.count ? "▍" : ""),
                                         Self.font(h * 0.034, weight: .medium, monospaced: true), white, 0)],
                                padding: CGSize(width: h * 0.026, height: h * 0.018), background: CGColor(red: 0.055, green: 0.067, blue: 0.118, alpha: 0.88))
        }
        guard let image else { return nil }
        let ci = CIImage(cgImage: image)
        cache.withLock { $0[key] = ci }
        return ci
    }

    // MARK: Captions

    /// The caption line active at `t`, with the current word highlighted.
    func caption(_ captions: EditSettings.Captions, at t: Double, canvas: CGRect, accent: CGColor) -> CIImage? {
        guard captions.enabled, !captions.words.isEmpty else { return nil }
        let lines = Self.lines(captions.words)
        guard let lineIndex = lines.firstIndex(where: { t >= $0.first!.start - 0.05 && t <= $0.last!.end + 0.4 }) else { return nil }
        let line = lines[lineIndex]
        let active = captions.highlightActiveWord ? line.firstIndex { t >= $0.start && t < $0.end } ?? -1 : -1
        let key = "cap-\(lineIndex)-\(active)-\(Int(canvas.height))-\(captions.size)-\(line.map(\.text).joined().hashValue)"
        let image: CIImage
        if let cached = cache.withLock({ $0[key] }) {
            image = cached
        } else {
            guard let cg = Self.renderCaption(line.map(\.text), active: active, height: canvas.height * captions.size, accent: accent) else { return nil }
            image = CIImage(cgImage: cg)
            cache.withLock { $0[key] = image }
        }
        let center = CGPoint(x: canvas.midX, y: (1 - captions.position) * canvas.height)
        return image.transformed(by: CGAffineTransform(translationX: center.x - image.extent.width / 2, y: center.y - image.extent.height / 2))
    }

    /// Groups words into short lines: up to 7 words or 2.6 s, breaking at sentence ends.
    static func lines(_ words: [EditSettings.CaptionWord]) -> [[EditSettings.CaptionWord]] {
        var lines: [[EditSettings.CaptionWord]] = [], current: [EditSettings.CaptionWord] = []
        for word in words.sorted(by: { $0.start < $1.start }) {
            if let first = current.first, current.count >= 7 || word.end - first.start > 2.6 || (current.last.map { word.start - $0.end > 0.8 } ?? false) {
                lines.append(current); current = []
            }
            current.append(word)
            if word.text.hasSuffix(".") || word.text.hasSuffix("?") || word.text.hasSuffix("!") { lines.append(current); current = [] }
        }
        if !current.isEmpty { lines.append(current) }
        return lines
    }

    // MARK: Drawing

    private typealias Line = (text: String, font: CTFont, color: CGColor, tracking: CGFloat)

    private static func font(_ size: CGFloat, weight: CGFloat, monospaced: Bool = false, serifItalic: Bool = false) -> CTFont {
        if serifItalic {
            return CTFontCreateWithName("NewYorkItalic" as CFString, size, nil).hasName("NewYork")
                ?? CTFontCreateWithName("Georgia-Italic" as CFString, size, nil)
        }
        let base = CTFontCreateUIFontForLanguage(monospaced ? .userFixedPitch : .system, size, nil)!
        let traits: [CFString: Any] = [kCTFontWeightTrait: weight]
        let descriptor = CTFontDescriptorCreateCopyWithAttributes(CTFontCopyFontDescriptor(base), [kCTFontTraitsAttribute: traits] as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }

    private static func attributed(_ line: Line) -> CTLine {
        CTLineCreateWithAttributedString(NSAttributedString(string: line.text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): line.font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): line.color,
            NSAttributedString.Key(kCTKernAttributeName as String): line.tracking * CTFontGetSize(line.font),
        ]))
    }

    private static func render(lines: [Line], padding: CGSize, background: CGColor?, shadow: Bool = false,
                               accentBar: Bool = false, alignLeft: Bool = false, capsule: Bool = false) -> CGImage? {
        let visible = lines.filter { !$0.text.isEmpty }
        guard !visible.isEmpty else { return nil }
        let ctLines = visible.map(attributed)
        let metrics = ctLines.map { line -> (width: CGFloat, ascent: CGFloat, descent: CGFloat) in
            var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
            let width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
            return (CGFloat(width), ascent, descent)
        }
        let spacing = (metrics.first?.ascent ?? 10) * 0.22
        let contentWidth = metrics.map(\.width).max() ?? 0
        let contentHeight = metrics.reduce(0) { $0 + $1.ascent + $1.descent } + spacing * CGFloat(max(metrics.count - 1, 0))
        let bar: CGFloat = accentBar ? max(4, contentHeight * 0.06) : 0
        let margin: CGFloat = shadow ? contentHeight * 0.25 : 2
        let size = CGSize(width: ceil(contentWidth + padding.width * 2 + bar + (accentBar ? padding.width * 0.6 : 0) + margin * 2),
                          height: ceil(contentHeight + padding.height * 2 + margin * 2))
        guard let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        let box = CGRect(x: margin, y: margin, width: size.width - margin * 2, height: size.height - margin * 2)
        if let background {
            let radius = capsule ? box.height / 2 : min(box.height * 0.18, 18)
            ctx.addPath(CGPath(roundedRect: box, cornerWidth: radius, cornerHeight: radius, transform: nil))
            ctx.setFillColor(background)
            ctx.fillPath()
        }
        if accentBar {
            ctx.setFillColor(CGColor(red: 0.067, green: 0.435, blue: 0.96, alpha: 1))
            ctx.fill(CGRect(x: box.minX + padding.width * 0.6, y: box.minY + padding.height, width: bar, height: box.height - padding.height * 2))
        }
        if shadow {
            ctx.setShadow(offset: CGSize(width: 0, height: -contentHeight * 0.02), blur: contentHeight * 0.12, color: CGColor(gray: 0, alpha: 0.45))
        }
        var y = box.maxY - padding.height
        let textLeft = box.minX + padding.width + (accentBar ? bar + padding.width * 0.6 : 0)
        for (line, m) in zip(ctLines, metrics) {
            y -= m.ascent
            let x = alignLeft ? textLeft : box.minX + (box.width - m.width) / 2
            ctx.textPosition = CGPoint(x: x, y: y)
            CTLineDraw(line, ctx)
            y -= m.descent + spacing
        }
        return ctx.makeImage()
    }

    private static func renderCaption(_ words: [String], active: Int, height: CGFloat, accent: CGColor) -> CGImage? {
        let font = Self.font(height, weight: 0.4)
        let space = height * 0.28
        let ctWords = words.map { attributed(($0, font, CGColor(gray: 1, alpha: 1), 0)) }
        let widths = ctWords.map { CGFloat(CTLineGetTypographicBounds($0, nil, nil, nil)) }
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font)
        let pad = CGSize(width: height * 0.6, height: height * 0.35)
        let textWidth = widths.reduce(0, +) + space * CGFloat(max(words.count - 1, 0))
        let size = CGSize(width: ceil(textWidth + pad.width * 2), height: ceil(ascent + descent + pad.height * 2))
        guard let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        let box = CGRect(origin: .zero, size: size)
        ctx.addPath(CGPath(roundedRect: box, cornerWidth: size.height * 0.28, cornerHeight: size.height * 0.28, transform: nil))
        ctx.setFillColor(CGColor(red: 0.055, green: 0.067, blue: 0.118, alpha: 0.78))
        ctx.fillPath()
        var x = pad.width
        for (i, line) in ctWords.enumerated() {
            if i == active {
                let r = CGRect(x: x - height * 0.14, y: pad.height - descent - height * 0.06, width: widths[i] + height * 0.28, height: ascent + descent + height * 0.12)
                ctx.addPath(CGPath(roundedRect: r, cornerWidth: height * 0.16, cornerHeight: height * 0.16, transform: nil))
                ctx.setFillColor(accent)
                ctx.fillPath()
            }
            ctx.textPosition = CGPoint(x: x, y: pad.height)
            CTLineDraw(line, ctx)
            x += widths[i] + space
        }
        return ctx.makeImage()
    }
}

private extension CTFont {
    /// Self if its PostScript name contains `name` (font fallback check).
    nonisolated func hasName(_ name: String) -> CTFont? {
        (CTFontCopyPostScriptName(self) as String).contains(name) ? self : nil
    }
}

/// CoreText weight trait values (−1…1).
nonisolated private extension CGFloat {
    static let regular: CGFloat = 0
    static let medium: CGFloat = 0.23
    static let semibold: CGFloat = 0.3
    static let bold: CGFloat = 0.4
    static let heavy: CGFloat = 0.56
}
