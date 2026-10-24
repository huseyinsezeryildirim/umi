import CoreImage
import XCTest
@testable import Umi

/// Renders the shared golden scenarios (crates/umi-render/tests/golden/scenarios.json) with
/// the Swift renderer, so the v2 Rust renderer can be compared against it.
final class GoldenExportTests: XCTestCase {
    @MainActor
    func testExportGoldenFrames() throws {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let scenariosURL = repo.appendingPathComponent("crates/umi-render/tests/golden/scenarios.json")
        let bundle = URL(fileURLWithPath: "/tmp/umi-fixtures/Real.umi")
        let out = URL(fileURLWithPath: "/tmp/umi-golden")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: bundle.path) && FileManager.default.fileExists(atPath: out.appendingPathComponent("screen.png").path))

        var project = try ProjectStore.read(RecordingProject.self, from: bundle.appendingPathComponent(RecordingProject.fileName))
        let cursor = (try? ProjectStore.read(CursorData.self, from: bundle.appendingPathComponent(RecordingProject.cursorFile))) ?? CursorData()
        let screen = try XCTUnwrap(CIImage(contentsOf: out.appendingPathComponent("screen.png")))
        let camera = CIImage(contentsOf: out.appendingPathComponent("camera.png"))

        let scenarios = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: scenariosURL)) as? [[String: Any]])
        let defaults = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(EditSettings())) as? [String: Any])
        for scenario in scenarios {
            let name = try XCTUnwrap(scenario["name"] as? String)
            let time = try XCTUnwrap(scenario["time"] as? Double)
            let size = try XCTUnwrap(scenario["size"] as? [Double])
            var merged = defaults
            for (k, v) in (scenario["edit"] as? [String: Any]) ?? [:] { merged[k] = v }
            let edit = try JSONDecoder().decode(EditSettings.self, from: JSONSerialization.data(withJSONObject: merged))
            project.edit = edit
            let renderer = FrameRenderer(project: project, cursorData: cursor, cursorImage: .arrow, bundle: bundle)
            let image = renderer.compose(screen: screen, camera: camera, at: time, size: CGSize(width: size[0], height: size[1]))
            try FrameRenderer.context.writePNGRepresentation(of: image, to: out.appendingPathComponent("swift-\(name).png"),
                                                            format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        }
    }
}
