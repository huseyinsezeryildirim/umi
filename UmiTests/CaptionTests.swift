import XCTest
@testable import Umi

final class CaptionTests: XCTestCase {
    private let words: [EditSettings.CaptionWord] = [
        .init(start: 0.0, end: 0.4, text: "Hello"), .init(start: 0.4, end: 0.9, text: "world."),
        .init(start: 1.0, end: 1.3, text: "This"), .init(start: 1.3, end: 1.5, text: "is"), .init(start: 1.5, end: 2.0, text: "Umi"),
    ]

    func testLinesBreakAtSentenceEnds() {
        let lines = TextRenderer.lines(words)
        XCTAssertEqual(lines.map { $0.map(\.text).joined(separator: " ") }, ["Hello world.", "This is Umi"])
    }

    func testSRTAndVTTUseOutputTime() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("caps.srt")
        // Output timeline shifted by +10 s.
        try SubtitleWriter.write(words, format: .srt, mapTime: { $0 + 10 }, to: url)
        let srt = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(srt.hasPrefix("1\n00:00:10,000 --> 00:00:10,900\nHello world."))
        try SubtitleWriter.write(words, format: .vtt, mapTime: { $0 }, to: url)
        let vtt = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(vtt.hasPrefix("WEBVTT\n\n00:00:00.000 --> 00:00:00.900\nHello world."))
    }

    func testCutWordsAreDropped() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("caps.vtt")
        try SubtitleWriter.write(words, format: .vtt, mapTime: { $0 < 1 ? nil : $0 }, to: url)
        let vtt = try String(contentsOf: url, encoding: .utf8)
        XCTAssertFalse(vtt.contains("Hello"))
        XCTAssertTrue(vtt.contains("This is Umi"))
    }
}
