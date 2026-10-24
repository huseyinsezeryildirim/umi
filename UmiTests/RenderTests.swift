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

    /// Media track: a video filling the screen, then an image as picture-in-picture.
    @MainActor
    func testMediaTrackOverlays() async throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: fixture.path), "Run scripts/make-fixture.sh first")
        let fm = FileManager.default
        try? fm.removeItem(at: fixture.appendingPathComponent("media-video.mov"))
        try fm.copyItem(at: fixture.appendingPathComponent(RecordingProject.cameraFile), to: fixture.appendingPathComponent("media-video.mov"))
        let png = root.appendingPathComponent("frames/frame-0.5.png")
        try XCTSkipUnless(fm.fileExists(atPath: png.path), "needs testExportProducesComposedMP4 frames")
        try? fm.removeItem(at: fixture.appendingPathComponent("media-image.png"))
        try fm.copyItem(at: png, to: fixture.appendingPathComponent("media-image.png"))

        var project = try ProjectStore.read(RecordingProject.self, from: fixture.appendingPathComponent(RecordingProject.fileName))
        var edit = EditSettings()
        edit.overlays = [.init(file: "media-video.mov", kind: .video, start: 0.5, end: 2.5, mode: .fill),
                         .init(file: "media-image.png", kind: .image, start: 3, end: 5, mode: .pictureInPicture)]
        project.edit = edit
        let cursor = try ProjectStore.read(CursorData.self, from: fixture.appendingPathComponent(RecordingProject.cursorFile))
        let renderer = FrameRenderer(project: project, cursorData: cursor, cursorImage: .arrow, bundle: fixture)
        let output = root.appendingPathComponent("export-media.mp4")
        try await Exporter.export(bundle: fixture, renderer: renderer, resolution: .p720, fps: 30, to: output)
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: output))
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        for t in [1.5, 4.0] {
            let (image, _) = try await generator.image(at: CMTime(seconds: t, preferredTimescale: 600))
            try CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: root.appendingPathComponent("frames/media-\(t).png"),
                                                   format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
    }

    /// Instant mode's export: default look applied, an MP4 lands in the folder.
    @MainActor
    func testInstantExport() async throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: fixture.path), "Run scripts/make-fixture.sh first")
        let folder = root.appendingPathComponent("instant")
        let url = try await InstantShareController.exportPolished(fixture, to: folder) { _ in }
        let duration = try await AVURLAsset(url: url).load(.duration).seconds
        XCTAssertEqual(duration, 6, accuracy: 0.2)
    }

    /// Crop to the left half and export vertical 9:16.
    @MainActor
    func testCropAndVerticalAspect() async throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: fixture.path), "Run scripts/make-fixture.sh first")
        var project = try ProjectStore.read(RecordingProject.self, from: fixture.appendingPathComponent(RecordingProject.fileName))
        var edit = EditSettings()
        edit.crop = CGRect(x: 0, y: 0, width: 0.5, height: 1)
        edit.aspect = .vertical
        edit.zoom.auto = false
        edit.border = 0.006
        project.edit = edit
        let cursor = try ProjectStore.read(CursorData.self, from: fixture.appendingPathComponent(RecordingProject.cursorFile))
        let renderer = FrameRenderer(project: project, cursorData: cursor, cursorImage: .arrow, bundle: fixture)
        let output = root.appendingPathComponent("export-vertical.mp4")
        try await Exporter.export(bundle: fixture, renderer: renderer, resolution: .p720, fps: 30, to: output)
        let asset = AVURLAsset(url: output)
        let size = try await asset.loadTracks(withMediaType: .video)[0].load(.naturalSize)
        XCTAssertEqual(size.width, 720)
        XCTAssertEqual(size.height, 1280)
        let (image, _) = try await AVAssetImageGenerator(asset: asset).image(at: CMTime(seconds: 1, preferredTimescale: 600))
        try CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: root.appendingPathComponent("frames/vertical.png"),
                                               format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    }

    func testCameraOnlyRecordingStartsAsCameraOnlyScene() {
        let project = RecordingProject(createdAt: .now, duration: 12, screen: .init(pixelWidth: 640, pixelHeight: 360, captureRect: .zero, fps: 15),
                                       camera: .init(), audio: .init(), cameraOnly: true)
        XCTAssertEqual(project.defaultEdit.scenes.first?.layout, .cameraOnly)
        XCTAssertEqual(project.defaultEdit.scenes.first?.end, 12)
    }

    func testTrimKeepsOnlySelectedClips() {
        let clips = CompositionBuilder.keptClips([.init(start: 1, end: 2), .init(start: 3, end: 10)], total: 6)
        XCTAssertEqual(clips, [.init(start: 1, end: 2), .init(start: 3, end: 6)])
        XCTAssertEqual(CompositionBuilder.keptClips([], total: 6), [.init(start: 0, end: 6)])
    }

    func testLayoutWithSpeedAndCrossfade() {
        let placements = CompositionBuilder.layout([.init(start: 0, end: 3, speed: 2), .init(start: 3, end: 6)], crossfade: 0.5)
        XCTAssertEqual(placements[0].outputDuration, 1.5, accuracy: 0.001)
        XCTAssertEqual(placements[1].outputStart, 1.0, accuracy: 0.001)
        XCTAssertEqual(placements[1].outputEnd, 4.0, accuracy: 0.001)
    }

    func testOldProjectJSONStillDecodes() throws {
        let json = #"{"padding":0.1,"clips":[{"start":0,"end":2}],"background":{"gradient":{"_0":"dusk"}}}"#
        let edit = try JSONDecoder().decode(EditSettings.self, from: Data(json.utf8))
        XCTAssertEqual(edit.padding, 0.1)
        XCTAssertEqual(edit.clips.first?.speed, 1)
        XCTAssertTrue(edit.masks.isEmpty)
    }

    /// Every studio feature at once; frames are saved for a visual check.
    @MainActor
    func testAllStudioFeaturesExport() async throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: fixture.path), "Run scripts/make-fixture.sh first")
        var project = try ProjectStore.read(RecordingProject.self, from: fixture.appendingPathComponent(RecordingProject.fileName))
        var edit = EditSettings()
        edit.frame = .macOS
        edit.background = .gradient(.navy)
        edit.backgroundAngle = 60
        edit.backgroundNoise = 0.5
        edit.masks = [.init(start: 0, end: 6, rect: CGRect(x: 0.05, y: 0.05, width: 0.3, height: 0.25), style: .blur, amount: 0.8),
                      .init(start: 0, end: 6, rect: CGRect(x: 0.6, y: 0.05, width: 0.3, height: 0.25), style: .pixelate, amount: 0.6)]
        edit.scenes = [.init(start: 3.4, end: 6, layout: .splitScreen)]
        edit.grade = .init(preset: .cinematic, vignette: 0.6, grain: 0.3)
        edit.texts = [.init(start: 0, end: 2.5, style: .lowerThird, text: "Sezer Yıldırım", detail: "Founder, Umi", position: CGPoint(x: 0.25, y: 0.82)),
                      .init(start: 0, end: 2.5, style: .bigStat, text: "42%", detail: "faster onboarding", position: CGPoint(x: 0.7, y: 0.4))]
        edit.moves = [.init(start: 4.5, end: 6, kind: .glide)]
        edit.captions = .init(enabled: true, words: [.init(start: 0.2, end: 0.6, text: "Here"), .init(start: 0.6, end: 0.9, text: "is"),
                                                     .init(start: 0.9, end: 1.2, text: "the"), .init(start: 1.2, end: 1.6, text: "new"),
                                                     .init(start: 1.6, end: 2.4, text: "dashboard")])
        edit.clips = [.init(start: 0, end: 3, speed: 2), .init(start: 3, end: 6)]
        edit.crossfade = 0.5
        edit.music = .init(file: "music-test.m4a")
        edit.zoom.auto = false
        project.edit = edit
        let cursor = try ProjectStore.read(CursorData.self, from: fixture.appendingPathComponent(RecordingProject.cursorFile))
        let renderer = FrameRenderer(project: project, cursorData: cursor, cursorImage: .arrow, bundle: fixture)

        let output = root.appendingPathComponent("export-all.mp4")
        try await Exporter.export(bundle: fixture, renderer: renderer, resolution: .p1080, fps: 30, to: output)
        let asset = AVURLAsset(url: output)
        let duration = try await asset.load(.duration).seconds
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(duration, 4.0, accuracy: 0.15)
        XCTAssertEqual(audioTracks.count, 1)

        let frames = root.appendingPathComponent("frames")
        try FileManager.default.createDirectory(at: frames, withIntermediateDirectories: true)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        // 0.5 s = source 1.0 (text, captions, masks); 1.25 = mid dissolve; 2.2 = source 4.2 split screen; 3.5 = source 5.5 glide.
        for t in [0.5, 1.25, 2.2, 3.5] {
            let (image, _) = try await generator.image(at: CMTime(seconds: t, preferredTimescale: 600))
            try CIContext().writePNGRepresentation(of: CIImage(cgImage: image), to: frames.appendingPathComponent("all-\(t).png"),
                                                   format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
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
