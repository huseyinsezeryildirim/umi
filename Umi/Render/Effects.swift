import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

/// Image effects used by `FrameRenderer`: privacy masks, color grades, grain and the
/// perspective of 3D camera moves.
nonisolated enum Effects {
    // MARK: Privacy masks

    /// Applies the masks active at `t` to the raw screen image (screen pixel space).
    static func applyMasks(_ masks: [EditSettings.PrivacyMask], to screen: CIImage, at t: Double) -> CIImage {
        let active = masks.filter { t >= $0.start && t <= $0.end }
        guard !active.isEmpty else { return screen }
        let extent = screen.extent
        var result = screen

        for mask in active {
            let fade = min((t - mask.start) / 0.2, (mask.end - t) / 0.2, 1)
            let r = CGRect(x: extent.minX + mask.rect.minX * extent.width,
                           y: extent.minY + (1 - mask.rect.maxY) * extent.height,
                           width: mask.rect.width * extent.width,
                           height: mask.rect.height * extent.height).intersection(extent)
            guard !r.isEmpty else { continue }
            let radius = min(r.width, r.height) * 0.08

            switch mask.style {
            case .blur:
                let sigma = 6 + 34 * mask.amount
                let blurred = result.clampedToExtent().applyingGaussianBlur(sigma: sigma).cropped(to: extent)
                result = blend(blurred, over: result, mask: roundedRect(r, radius: radius, alpha: fade))
            case .pixelate:
                let size = max(extent.width, extent.height) * (0.008 + 0.035 * mask.amount)
                let pixelated = result.clampedToExtent()
                    .applyingFilter("CIPixellate", parameters: [kCIInputScaleKey: size, kCIInputCenterKey: CIVector(cgPoint: r.origin)])
                    .cropped(to: extent)
                result = blend(pixelated, over: result, mask: roundedRect(r, radius: radius, alpha: fade))
            case .highlight:
                // Dim everything except the rect.
                let dim = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: (0.25 + 0.55 * mask.amount) * fade)).cropped(to: extent)
                let dimmed = dim.composited(over: result)
                result = blend(result, over: dimmed, mask: roundedRect(r, radius: radius, alpha: 1))
            }
        }
        return result
    }

    // MARK: Color

    static func grade(_ image: CIImage, _ grade: EditSettings.ColorGrade, canvas: CGRect, time: Double) -> CIImage {
        var out = image
        switch grade.preset {
        case .none:
            break
        case .cinematic:
            out = out.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: 7000, y: 6)])
            out = controls(out, saturation: 0.88, contrast: 1.12, brightness: -0.02)
        case .noir:
            out = out.applyingFilter("CIPhotoEffectNoir")
        case .vintage:
            out = out.applyingFilter("CISepiaTone", parameters: [kCIInputIntensityKey: 0.35])
            out = controls(out, saturation: 0.85, contrast: 0.92, brightness: 0.03)
        case .frost:
            out = out.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: 9000, y: 0)])
            out = controls(out, saturation: 0.85, contrast: 1, brightness: 0.03)
        case .golden:
            out = out.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: 4700, y: 0)])
            out = controls(out, saturation: 1.1, contrast: 1.04, brightness: 0.02)
        case .midnight:
            out = out.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: -0.35])
            out = out.applyingFilter("CITemperatureAndTint", parameters: ["inputNeutral": CIVector(x: 6500, y: 0), "inputTargetNeutral": CIVector(x: 8500, y: 10)])
            out = controls(out, saturation: 0.8, contrast: 1.15, brightness: 0)
        case .vivid:
            out = out.applyingFilter("CIVibrance", parameters: ["inputAmount": 0.5])
            out = controls(out, saturation: 1.15, contrast: 1.08, brightness: 0)
        case .dreamy:
            out = out.applyingFilter("CIBloom", parameters: [kCIInputRadiusKey: min(canvas.width, canvas.height) * 0.02, kCIInputIntensityKey: 0.45]).cropped(to: canvas)
            out = controls(out, saturation: 1.05, contrast: 0.95, brightness: 0.03)
        }
        if grade.exposure != 0 {
            out = out.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: grade.exposure * 1.5])
        }
        if grade.contrast != 0 || grade.saturation != 0 {
            out = controls(out, saturation: 1 + grade.saturation, contrast: 1 + grade.contrast * 0.5, brightness: 0)
        }
        if grade.vignette > 0 {
            out = out.applyingFilter("CIVignette", parameters: [kCIInputIntensityKey: grade.vignette * 1.6, kCIInputRadiusKey: 1.6]).cropped(to: canvas)
        }
        if grade.grain > 0 {
            out = grain(over: out, amount: grade.grain, canvas: canvas, seed: time)
        }
        return out.cropped(to: canvas)
    }

    /// Monochrome film grain; `seed` moves it between frames.
    static func grain(over image: CIImage, amount: Double, canvas: CGRect, seed: Double) -> CIImage {
        let offset = CGFloat((seed * 977).truncatingRemainder(dividingBy: 512))
        let noise = CIFilter.randomGenerator().outputImage!
            .transformed(by: CGAffineTransform(translationX: offset, y: offset * 0.6))
            .applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: 0, y: 1, z: 0, w: 0),
                "inputGVector": CIVector(x: 0, y: 1, z: 0, w: 0),
                "inputBVector": CIVector(x: 0, y: 1, z: 0, w: 0),
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 0.18 * amount),
            ])
            .cropped(to: canvas)
        return noise.applyingFilter("CISoftLightBlendMode", parameters: [kCIInputBackgroundImageKey: image]).cropped(to: canvas)
    }

    // MARK: 3D camera moves

    /// Perspective corners for `rect` rotated by `yaw`/`pitch` (radians) around its center,
    /// then scaled and shifted, as seen by a camera `distance` away.
    static func perspective(_ image: CIImage, rect: CGRect, yaw: Double, pitch: Double, scale: Double, shift: CGPoint) -> CIImage {
        let cx = rect.midX, cy = rect.midY
        let distance = Double(max(rect.width, rect.height)) * 2.2
        func project(_ x: Double, _ y: Double) -> CGPoint {
            // Rotate around Y (yaw), then X (pitch).
            var px = x, py = y, pz = 0.0
            let x1 = px * cos(yaw) + pz * sin(yaw), z1 = -px * sin(yaw) + pz * cos(yaw)
            px = x1; pz = z1
            let y2 = py * cos(pitch) - pz * sin(pitch), z2 = py * sin(pitch) + pz * cos(pitch)
            py = y2; pz = z2
            let f = distance / (distance + pz)
            return CGPoint(x: cx + px * f * scale + shift.x, y: cy + py * f * scale + shift.y)
        }
        let hw = Double(rect.width) / 2, hh = Double(rect.height) / 2
        return image.applyingFilter("CIPerspectiveTransform", parameters: [
            "inputTopLeft": CIVector(cgPoint: project(-hw, hh)),
            "inputTopRight": CIVector(cgPoint: project(hw, hh)),
            "inputBottomRight": CIVector(cgPoint: project(hw, -hh)),
            "inputBottomLeft": CIVector(cgPoint: project(-hw, -hh)),
        ])
    }

    /// The pose of an active 3D move at `t`, or nil. `amount` ramps in/out for focus blur.
    static func movePose(_ moves: [EditSettings.CameraMove], at t: Double, canvas: CGRect)
        -> (yaw: Double, pitch: Double, scale: Double, shift: CGPoint, amount: Double)? {
        guard let move = moves.first(where: { t >= $0.start && t <= $0.end }) else { return nil }
        let duration = max(move.end - move.start, 0.1)
        let p = (t - move.start) / duration
        let ramp = min(1, (t - move.start) / 0.6, (move.end - t) / 0.6)
        let amount = SceneLayoutEngine.ease(ramp)
        let w = Double(canvas.width)
        switch move.kind {
        case .glide:
            // Tilted, sliding from right to left across the frame.
            return (yaw: -0.32 * amount, pitch: 0.12 * amount, scale: 1 + 0.12 * amount,
                    shift: CGPoint(x: (0.12 - 0.24 * p) * w * amount, y: 0), amount: amount)
        case .unfold:
            // Starts leaning back and flattens out.
            let lean = (1 - SceneLayoutEngine.ease(min(p / 0.6, 1))) * 0.75 + 0.08
            return (yaw: 0, pitch: lean * amount, scale: 1, shift: .zero, amount: amount)
        case .pullBack:
            // Close and tilted, pulling back to show the whole frame.
            let q = SceneLayoutEngine.ease(p)
            return (yaw: (0.25 - 0.4 * q) * amount, pitch: 0.18 * amount, scale: 1 + (0.45 - 0.6 * q) * amount, shift: .zero, amount: amount)
        }
    }

    // MARK: Helpers

    static func roundedRect(_ rect: CGRect, radius: CGFloat, alpha: Double) -> CIImage {
        let filter = CIFilter.roundedRectangleGenerator()
        filter.extent = rect
        filter.radius = Float(radius)
        filter.color = CIColor(red: 1, green: 1, blue: 1, alpha: alpha)
        return filter.outputImage ?? CIImage.empty()
    }

    /// A rect with Apple's continuous (squircle) corners: the curve eases into the straight
    /// edges instead of meeting them at a hard tangent. Masks are cached by size.
    static func continuousRect(_ rect: CGRect, radius: CGFloat, alpha: Double) -> CIImage {
        let w = Int(rect.width.rounded(.up)), h = Int(rect.height.rounded(.up))
        guard w > 0, h > 0 else { return .empty() }
        let key = "\(w)x\(h)r\(Int(radius * 4))a\(Int(alpha * 100))" as NSString
        let mask: CIImage
        if let cached = squircleCache.object(forKey: key) {
            mask = cached.image
        } else {
            guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return .empty() }
            let bounds = CGRect(x: 0, y: 0, width: w, height: h)
            let path = RoundedRectangle(cornerRadius: min(radius, CGFloat(min(w, h)) / 2), style: .continuous).path(in: bounds).cgPath
            ctx.setFillColor(gray: alpha, alpha: 1)
            ctx.addPath(path)
            ctx.fillPath()
            guard let image = ctx.makeImage() else { return .empty() }
            // Gray → white with alpha, like the rounded-rect generator's output.
            mask = CIImage(cgImage: image).applyingFilter("CIMaskToAlpha")
            squircleCache.setObject(CachedImage(image: mask), forKey: key)
        }
        return mask.transformed(by: CGAffineTransform(translationX: rect.minX, y: rect.minY))
    }

    private final class CachedImage: @unchecked Sendable {
        let image: CIImage
        init(image: CIImage) { self.image = image }
    }

    nonisolated(unsafe) private static let squircleCache: NSCache<NSString, CachedImage> = {
        let cache = NSCache<NSString, CachedImage>()
        cache.countLimit = 24
        return cache
    }()

    static func blend(_ top: CIImage, over bottom: CIImage, mask: CIImage) -> CIImage {
        top.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: bottom, kCIInputMaskImageKey: mask])
    }

    private static func controls(_ image: CIImage, saturation: Double, contrast: Double, brightness: Double) -> CIImage {
        image.applyingFilter("CIColorControls", parameters: [
            kCIInputSaturationKey: saturation, kCIInputContrastKey: contrast, kCIInputBrightnessKey: brightness,
        ])
    }
}
