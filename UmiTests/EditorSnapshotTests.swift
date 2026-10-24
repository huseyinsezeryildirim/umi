import SwiftUI
import XCTest
@testable import Umi

/// Renders editor pieces off screen to /tmp/umi-fixtures for a visual check.
@MainActor
final class EditorSnapshotTests: XCTestCase {
    func testTimelineSnapshot() async throws {
        let fixture = URL(fileURLWithPath: "/tmp/umi-fixtures/Fixture.umi")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: fixture.path))
        let bundle = FileManager.default.temporaryDirectory.appendingPathComponent("Snap-\(UUID().uuidString).umi")
        try FileManager.default.copyItem(at: fixture, to: bundle)
        defer { try? FileManager.default.removeItem(at: bundle) }
        let model = EditorModel(bundle: bundle)
        for _ in 0..<100 where model.placements.isEmpty || model.waveform.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
        model.split(at: 3)
        model.addText(.title, at: 1)
        model.addMask(at: 4)
        model.selection = nil
        model.seek(to: 2)
        try await Task.sleep(for: .milliseconds(600))

        let view = EditorTimeline(model: model).frame(width: 1000, height: 260).environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
        try png.write(to: URL(fileURLWithPath: "/tmp/umi-fixtures/timeline.png"))
    }
}
