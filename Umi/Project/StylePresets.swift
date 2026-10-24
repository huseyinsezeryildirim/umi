import Foundation

/// A saved look: everything about how a recording is dressed, not what's in it (no cuts,
/// zooms, masks or text). One preset can be the default for new recordings.
nonisolated struct StylePreset: Codable, Hashable, Identifiable, Sendable {
    var id = UUID()
    var name: String
    var background: EditSettings.Background
    var backgroundAngle: Double
    var backgroundNoise: Double
    var frame: EditSettings.DeviceFrame
    var aspect: EditSettings.AspectRatio
    var padding: Double
    var cornerRadius: Double
    var cornerStyle: EditSettings.CornerStyle?
    var shadow: Double
    var border: Double?
    var cursor: EditSettings.Cursor
    var cameraShape: EditSettings.Camera.Shape
    var cameraSize: Double
    var cameraMirrored: Bool
    var grade: EditSettings.ColorGrade

    init(name: String, from edit: EditSettings) {
        self.name = name
        background = edit.background
        backgroundAngle = edit.backgroundAngle
        backgroundNoise = edit.backgroundNoise
        frame = edit.frame
        aspect = edit.aspect
        padding = edit.padding
        cornerRadius = edit.cornerRadius
        cornerStyle = edit.cornerStyle
        shadow = edit.shadow
        border = edit.border
        cursor = edit.cursor
        cameraShape = edit.camera.shape
        cameraSize = edit.camera.size
        cameraMirrored = edit.camera.mirrored
        grade = edit.grade
    }

    func apply(to edit: inout EditSettings) {
        edit.background = background
        edit.backgroundAngle = backgroundAngle
        edit.backgroundNoise = backgroundNoise
        edit.frame = frame
        edit.aspect = aspect
        edit.padding = padding
        edit.cornerRadius = cornerRadius
        edit.cornerStyle = cornerStyle ?? .rounded
        edit.shadow = shadow
        edit.border = border ?? 0
        edit.cursor = cursor
        edit.camera.shape = cameraShape
        edit.camera.size = cameraSize
        edit.camera.mirrored = cameraMirrored
        edit.grade = grade
    }
}

/// Saved presets, kept in UserDefaults.
nonisolated enum StylePresets {
    private static let key = "stylePresets"
    private static let defaultKey = "defaultStylePreset"

    static var all: [StylePreset] {
        get { UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode([StylePreset].self, from: $0) } ?? [] }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: key) }
    }

    /// Applied to new recordings (editor first open and Instant mode).
    static var defaultID: UUID? {
        get { UserDefaults.standard.string(forKey: defaultKey).flatMap(UUID.init) }
        set { UserDefaults.standard.set(newValue?.uuidString, forKey: defaultKey) }
    }

    static var defaultPreset: StylePreset? { all.first { $0.id == defaultID } }
}
