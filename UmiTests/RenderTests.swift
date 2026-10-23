import AVFoundation
import CoreImage
import XCTest
@testable import Umi

/// Exports the synthetic project from scripts/make-fixture.sh and checks the result.
/// Frames are written to /tmp/umi-fixtures/frames for a visual check.
/// (Fixtures live in /tmp because the test host can't read ~/Desktop without a privacy prompt.)
final class RenderTests: XCTestCase {
    private let root = URL(fileURLWithPath: "/tmp/umi-fixtures")
    private var fixture: URL { root.appendingPathComponent("Fixture.umi") }

    @MainActor
    func testExportProducesComposedMP4() async throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: fixture.path), "Run scripts/make-fixture.sh first")
        var project = try ProjectStore.read(RecordingProject.self, from: fixture.appendingPathComponent(RecordingProject.fileName))
        project.edit = EditSettings()
        let cursor = try ProjectStore.read(CursorData.self, from: fixture.appendingPathComponent(RecordingProject.cursorFile))
        let renderer = FrameRenderer(project: project, cursorData: cursor, cursorImage: .arrow)

        XCTAssertEqual(renderer.zoomSegments.count, 1, "two nearby clicks should merge into one auto zoom")

        let output = root.appendingPathComponent("export.mp4")
        try await Exporter.export(bundle: fixture, renderer: renderer, resolution: .p1080, fps: 30, to: output)

        let asset = AVURLAsset(url: output)
        let duration = try await asset.load(.duration).seconds
        XCTAssertEqual(duration, 6, accuracy: 0.2)
        let video = try await asset.loadTracks(withMediaType: .video)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(video.count, 1)
        XCTAssertEqual(audio.count, 1, "system audio and mic should be mixed into one track")
        let size = try await video[0].load(.naturalSize)
        XCTAssertEqual(size.height, 1080)

        let frames = root.appendingPathComponent("frames")
        try FileManager.default.createDirectory(at: frames, withIntermediateDirectories: true)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        for t in [0.5, 1.55, 2.4] {
            let (image, _) = try await generator.image(at: CMTime(seconds: t, preferredTimescale: 600))
            let url = frames.appendingPathComponent("frame-\(t).png")
            try CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: url, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
    }

    func testTrimKeepsOnlySelectedClips() {
        let clips = CompositionBuilder.keptClips([.init(start: 1, end: 2), .init(start: 3, end: 10)], total: 6)
        XCTAssertEqual(clips, [.init(start: 1, end: 2), .init(start: 3, end: 6)])
        XCTAssertEqual(CompositionBuilder.keptClips([], total: 6), [.init(start: 0, end: 6)])
    }

    func testClockRemovesPauses() {
        let clock = RecordingClock()
        clock.start()
        let t0 = RecordingClock.hostNow
        XCTAssertNotNil(clock.map(t0))
        clock.pause()
        XCTAssertNil(clock.now, "samples during a pause are dropped")
        clock.resume()
        XCTAssertNotNil(clock.now)
    }
}
