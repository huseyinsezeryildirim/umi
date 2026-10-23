import XCTest
@testable import Umi

/// Drives the editor's model the way the timeline and inspector do, on the fixture project
/// (a copy, so the fixture stays untouched).
@MainActor
final class EditorModelTests: XCTestCase {
    private var bundle: URL!

    override func setUp() async throws {
        let fixture = URL(fileURLWithPath: "/tmp/umi-fixtures/Fixture.umi")
        try XCTSkipUnless(FileManager.default.fileExists(atPath: fixture.path), "Run scripts/make-fixture.sh first")
        bundle = FileManager.default.temporaryDirectory.appendingPathComponent("EditorModelTests-\(UUID().uuidString).umi")
        try FileManager.default.copyItem(at: fixture, to: bundle)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: bundle)
    }

    private func loaded() async throws -> EditorModel {
        let model = EditorModel(bundle: bundle)
        for _ in 0..<100 where model.placements.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertFalse(model.placements.isEmpty)
        return model
    }

    private func settle(_ model: EditorModel) async throws {
        try await Task.sleep(for: .milliseconds(400))
    }

    func testSplitSpeedReorderDelete() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.outputDuration, 6, accuracy: 0.1)

        model.split(at: 2)
        try await settle(model)
        XCTAssertEqual(model.placements.count, 2)

        model.setSpeed(2, forClip: 0)
        try await settle(model)
        XCTAssertEqual(model.outputDuration, 5, accuracy: 0.1, "2 s at 2× takes 1 s")
        XCTAssertEqual(model.sourceTime(for: 0.5) ?? -1, 1.0, accuracy: 0.01)

        model.moveClip(from: 0, to: 1)
        try await settle(model)
        XCTAssertEqual(model.placements[0].clip.start, 2, accuracy: 0.01)
        XCTAssertEqual(model.placements[1].clip.speed, 2)

        model.selection = .clip(1)
        model.deleteSelection()
        try await settle(model)
        XCTAssertEqual(model.placements.count, 1)
        XCTAssertEqual(model.outputDuration, 4, accuracy: 0.1)
    }

    func testTimedItemsAddRetimeDelete() async throws {
        let model = try await loaded()
        model.seek(to: 1)
        model.addMask(at: 1)
        model.addScene(.splitScreen, at: 1)
        model.addText(.lowerThird, at: 1)
        model.addMove(.glide, at: 1)
        XCTAssertEqual(model.edit.masks.count, 1)
        XCTAssertEqual(model.edit.scenes.first?.layout, .splitScreen)
        XCTAssertEqual(model.edit.texts.first?.style, .lowerThird)
        XCTAssertEqual(model.edit.moves.first?.kind, .glide)
        if case .move = model.selection {} else { XCTFail("new item should be selected") }

        let mask = model.edit.masks[0]
        model.retime(.mask(mask.id), start: 2, end: 3.5)
        XCTAssertEqual(model.edit.masks[0].start, 2)
        XCTAssertEqual(model.edit.masks[0].end, 3.5)
        model.retime(.mask(mask.id), start: -5, end: 99)
        XCTAssertEqual(model.edit.masks[0].start, 0, "clamped to the recording")
        XCTAssertEqual(model.edit.masks[0].end, 6, accuracy: 0.01)

        model.updateMask(mask.id) { $0.style = .pixelate; $0.rect = CGRect(x: 0.1, y: 0.1, width: 0.2, height: 0.2) }
        XCTAssertEqual(model.edit.masks[0].style, .pixelate)

        model.selection = .mask(mask.id)
        XCTAssertTrue(model.editingOnPreview, "masks are placed on a flat preview")
        model.deleteSelection()
        XCTAssertTrue(model.edit.masks.isEmpty)
        XCTAssertNil(model.selection)
    }

    func testEditingAnAutoZoomMakesThemManual() async throws {
        let model = try await loaded()
        try await settle(model)
        let auto = try XCTUnwrap(model.zoomSegments.first)
        model.updateZoom(auto.id) { $0.scale = 3; $0.focus = CGPoint(x: 0.2, y: 0.3) }
        XCTAssertFalse(model.edit.zoom.auto)
        XCTAssertEqual(model.edit.zoom.segments.first?.scale, 3)
        XCTAssertEqual(model.edit.zoom.segments.first?.focus, CGPoint(x: 0.2, y: 0.3))
    }

    func testUndoRestoresEdit() async throws {
        let model = try await loaded()
        let undo = UndoManager()
        undo.groupsByEvent = false
        model.undoManager = undo
        undo.beginUndoGrouping()
        model.update { $0.padding = 0.2 }
        undo.endUndoGrouping()
        XCTAssertEqual(model.edit.padding, 0.2)
        undo.undo()
        XCTAssertEqual(model.edit.padding, EditSettings().padding)
    }

    func testEditsAreSavedToProjectFile() async throws {
        let model = try await loaded()
        model.update { $0.grade.preset = .noir }
        try await Task.sleep(for: .milliseconds(800))
        let saved = try ProjectStore.read(RecordingProject.self, from: bundle.appendingPathComponent(RecordingProject.fileName))
        XCTAssertEqual(saved.edit?.grade.preset, .noir)
    }
}
