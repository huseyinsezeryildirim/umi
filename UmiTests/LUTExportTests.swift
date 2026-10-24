import CoreImage
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import Umi

/// Bakes each color-grade preset's Core Image filter chain into a 33³ 3D LUT (16-bit PNG,
/// 1089×33: blue slices side by side), so the cross-platform renderer applies exactly the
/// same colors without Core Image.
final class LUTExportTests: XCTestCase {
    static let n = 33

    func testExportGradeLUTs() throws {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let folder = repo.appendingPathComponent("crates/umi-render/assets/luts")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let n = Self.n
        let width = n * n, height = n
        // Identity lattice: x = b·n + r, y = g.
        var pixels = [UInt16](repeating: 0, count: width * height * 4)
        for g in 0..<n {
            for b in 0..<n {
                for r in 0..<n {
                    let i = (g * width + b * n + r) * 4
                    pixels[i] = UInt16(r * 65535 / (n - 1))
                    pixels[i + 1] = UInt16(g * 65535 / (n - 1))
                    pixels[i + 2] = UInt16(b * 65535 / (n - 1))
                    pixels[i + 3] = 65535
                }
            }
        }
        let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
        let data = pixels.withUnsafeBufferPointer { Data(buffer: $0) }
        let identity = CIImage(bitmapData: data, bytesPerRow: width * 8, size: CGSize(width: width, height: height), format: .RGBA16, colorSpace: srgb)
        let canvas = CGRect(x: 0, y: 0, width: width, height: height)

        for preset in EditSettings.GradePreset.allCases where preset != .none {
            var graded: CIImage
            if preset == .dreamy {
                // Bloom is spatial (done in the shader); bake only its color controls.
                graded = identity.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.05, kCIInputContrastKey: 0.95, kCIInputBrightnessKey: 0.03])
            } else {
                graded = Effects.grade(identity, EditSettings.ColorGrade(preset: preset), canvas: canvas, time: 0)
            }
            graded = graded.cropped(to: canvas)
            var out = [UInt16](repeating: 0, count: width * height * 4)
            out.withUnsafeMutableBytes { buffer in
                FrameRenderer.context.render(graded, toBitmap: buffer.baseAddress!, rowBytes: width * 8, bounds: canvas, format: .RGBA16, colorSpace: srgb)
            }
            // CI renders bottom-up relative to our lattice rows only if flipped; the lattice is
            // symmetric in row order handling below: row y of the bitmap is CI's top row.
            let outData = out.withUnsafeBufferPointer { Data(buffer: $0) }
            let provider = CGDataProvider(data: outData as CFData)!
            let cg = CGImage(width: width, height: height, bitsPerComponent: 16, bitsPerPixel: 64, bytesPerRow: width * 8, space: srgb,
                             bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder16Little.rawValue),
                             provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
            let url = folder.appendingPathComponent("\(preset.rawValue).png")
            let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, cg, nil)
            XCTAssertTrue(CGImageDestinationFinalize(dest))
        }
    }
}
