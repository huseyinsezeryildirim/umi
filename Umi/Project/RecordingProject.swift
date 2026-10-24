import Foundation

/// A recording on disk: a `.umi` folder holding each track separately plus metadata.
///
///     Umi 2026-10-23 at 20.41.07.umi/
///       project.json   this struct
///       screen.mov     screen video (no cursor, no camera) + system audio + mic tracks
///       camera.mov     camera video, if the camera was on
///       cursor.json    `CursorData`
nonisolated struct RecordingProject: Codable, Hashable {
    static let fileName = "project.json"
    static let screenFile = "screen.mov"
    static let cameraFile = "camera.mov"
    static let cursorFile = "cursor.json"

    var version = 1
    var createdAt: Date
    var duration: Double
    var screen: Screen
    var camera: Camera?
    var audio: Audio
    var edit: EditSettings?
    /// Recorded in camera-only mode: the video starts as a full-length Camera Only scene.
    var cameraOnly: Bool?

    struct Screen: Codable, Hashable {
        var pixelWidth: Int
        var pixelHeight: Int
        /// Captured area in global screen points (top-left origin).
        var captureRect: CGRect
        var fps: Int
    }

    struct Camera: Codable, Hashable {
        /// Where the bubble sat during recording, as the bubble's center normalized to the
        /// captured area. The editor uses it as the default camera position.
        var bubbleCenter: CGPoint?
        /// Shape, size, mirror and position of the bubble when recording stopped, so the
        /// editor starts with what the user saw.
        var bubble: EditSettings.Camera?
    }

    struct Audio: Codable, Hashable {
        /// Index of each audio track inside screen.mov.
        var systemTrack: Int?
        var microphoneTrack: Int?
    }
}

nonisolated struct CursorData: Codable, Hashable {
    var moves: [Move] = []
    var clicks: [Click] = []

    struct Move: Codable, Hashable {
        var t: Double
        var x: Double
        var y: Double
    }

    struct Click: Codable, Hashable {
        enum Button: String, Codable { case left, right, other }
        var t: Double
        var x: Double
        var y: Double
        var button: Button
    }
}

nonisolated enum ProjectStore {
    static func write<T: Encodable>(_ value: T, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(value).write(to: url, options: .atomic)
    }

    static func read<T: Decodable>(_ type: T.Type, from url: URL) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(type, from: Data(contentsOf: url))
    }
}

nonisolated extension RecordingProject {
    /// The edit a recording starts with (editor first open, Instant mode): Umi's default
    /// look, with the camera where and how the bubble was while recording.
    var defaultEdit: EditSettings {
        var edit = EditSettings()
        if let bubble = camera?.bubble {
            edit.camera = bubble
        } else if let center = camera?.bubbleCenter {
            edit.camera.position = CGPoint(x: min(max(center.x, 0.08), 0.92), y: min(max(center.y, 0.1), 0.9))
        }
        if cameraOnly == true {
            edit.scenes = [EditSettings.SceneSegment(start: 0, end: max(duration, 0.1), layout: .cameraOnly, transition: 0)]
        }
        return edit
    }
}
