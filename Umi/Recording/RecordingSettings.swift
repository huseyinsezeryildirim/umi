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
    var captureMicrophone = true
    var captureSystemAudio = true
    var countdown = true
}
