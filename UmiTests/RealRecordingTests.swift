import AVFoundation
import CoreImage
import XCTest
@testable import Umi

/// Renders a real recording copied to /tmp/umi-fixtures/Real.umi (skipped when absent).
final class RealRecordingTests: XCTestCase {
    @MainActor
    func testRealRecordingRendersScreenAndCamera() async throws {
        let bundle = URL(fileURLWithPath: "/tmp/umi-fixtures/Real.umi")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: bundle.path))
        let project = try ProjectStore.read(RecordingProject.self, from: bundle.appendingPathComponent(RecordingProject.fileName))
        let cursor = try ProjectStore.read(CursorData.self, from: bundle.appendingPathComponent(RecordingProject.cursorFile))
        let renderer = FrameRenderer(project: project, cursorData: cursor, cursorImage: .arrow, bundle: bundle)
        let built = try await CompositionBuilder.build(bundle: bundle, renderer: renderer, renderSize: CGSize(width: 1280, height: 828))
        for track in built.composition.tracks {
            print("TRACK", track.mediaType.rawValue, track.trackID, track.timeRange.start.seconds, track.timeRange.duration.seconds, track.segments.count)
        }
        let generator = AVAssetImageGenerator(asset: built.composition)
        generator.videoComposition = built.videoComposition
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        for t in [0.0, 1.0, 5.0] {
            let (image, _) = try await generator.image(at: CMTime(seconds: t, preferredTimescale: 600))
            try CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: URL(fileURLWithPath: "/tmp/umi-fixtures/real-\(t).png"),
                                                   format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
    }
}
