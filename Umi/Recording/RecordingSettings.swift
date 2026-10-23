import CoreGraphics

enum CaptureMode: Hashable {
    case display
    case window
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
}
