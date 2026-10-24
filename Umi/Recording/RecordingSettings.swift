import CoreGraphics
import Foundation

enum CaptureMode: Hashable {
    case display
    case window
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
