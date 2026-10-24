import CoreGraphics
import Foundation

enum CaptureMode: Hashable {
    case display
    case window
    /// A rectangle picked on screen (`RecordingSettings.areaRect`).
    case area
    /// Just the camera (the screen is still captured small, for the audio, but hidden).
    case cameraOnly
}

/// Output quality, remembered between recordings.
struct RecordingQuality: Codable, Hashable {
    enum Resolution: String, Codable, CaseIterable {
        case native, p1080, p720
        var label: String { self == .native ? "Native (Retina)" : self == .p1080 ? "1080p" : "720p" }
        /// Max output height in pixels; nil = the display's own resolution.
        var maxHeight: Int? { self == .native ? nil : self == .p1080 ? 1080 : 720 }
    }

    var resolution = Resolution.native
    var fps = 60

    static var saved: RecordingQuality {
        get { UserDefaults.standard.data(forKey: "recordingQuality").flatMap { try? JSONDecoder().decode(Self.self, from: $0) } ?? RecordingQuality() }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "recordingQuality") }
    }
}

/// What happens when a recording stops.
enum RecordingFlow: String, CaseIterable {
    /// Polish with the default look, export, and put the video on the clipboard to share.
    case instant
    /// Open the editor first.
    case studio

    static var saved: RecordingFlow {
        get { UserDefaults.standard.string(forKey: "recordingFlow").flatMap(RecordingFlow.init) ?? .studio }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "recordingFlow") }
    }
}

struct RecordingSettings {
    var mode: CaptureMode = .display
    var displayID: CGDirectDisplayID?
    var windowID: CGWindowID?
    /// The picked area in global screen points (top-left origin).
    var areaRect: CGRect?
    var quality = RecordingQuality.saved {
        didSet { RecordingQuality.saved = quality }
    }
    var showCamera = true
    /// `AVCaptureDevice.uniqueID`; nil = system default.
    var cameraID: String?
    var captureMicrophone = true
    /// `AVCaptureDevice.uniqueID`; nil = system default.
    var microphoneID: String?
    var captureSystemAudio = true
    var countdown = true
    var flow = RecordingFlow.saved {
        didSet { RecordingFlow.saved = flow }
    }
}
