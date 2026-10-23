import AVFoundation
import ScreenCaptureKit
import SwiftUI

struct MenuBarLabel: View {
    @Environment(RecordingController.self) private var recorder
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        label
            #if DEBUG
            .task {
                // Dev hook: UMI_OPEN_EDITOR=/path/to/Some.umi opens that project on launch.
                if let path = ProcessInfo.processInfo.environment["UMI_OPEN_EDITOR"] {
                    openWindow(id: WindowID.editor, value: URL(fileURLWithPath: path))
                    NSApp.activate()
                }
            }
            #endif
    }

    @ViewBuilder
    private var label: some View {
        switch recorder.phase {
        case .recording, .paused:
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                Label(recorder.elapsed.formattedDuration, systemImage: recorder.phase == .paused ? "pause.circle.fill" : "record.circle.fill")
                    .labelStyle(.titleAndIcon)
            }
        default:
            Image(systemName: "record.circle")
        }
    }
}

/// The launcher: pick what to record, check camera and mic, start.
struct MenuBarView: View {
    @Environment(RecordingController.self) private var recorder
    @Environment(RecordingsLibrary.self) private var library
    @Environment(\.openWindow) private var openWindow
    @State private var mic = MicLevelMonitor()
    @State private var microphones: [AVCaptureDevice] = []
    @AppStorage("onboardingStep") private var onboardingStep = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            if let step = OnboardingStep(rawValue: onboardingStep), recorder.phase == .idle {
                OnboardingCard(step: step) { advanceTour() } close: { onboardingStep = OnboardingStep.done }
            }

            switch recorder.phase {
            case .idle:
                setup
            case .countingDown:
                status("Get ready…", systemImage: "timer")
                Button("Cancel", role: .cancel) { recorder.cancel() }
            case .recording, .paused:
                active
            case .finishing:
                status("Saving recording…", systemImage: "arrow.down.doc")
            }

            if let error = recorder.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .frame(width: 340)
        .task {
            await recorder.refreshSources()
            microphones = CaptureDevices.microphones
        }
        .onAppear {
            recorder.launcherDidOpen()
            if recorder.settings.captureMicrophone { mic.start(deviceID: recorder.settings.microphoneID) }
        }
        .onDisappear {
            recorder.launcherDidClose()
            mic.stop()
        }
        .onChange(of: recorder.lastFinishedURL) { _, url in
            guard let url else { return }
            library.reload(selecting: url)
            openWindow(id: WindowID.editor, value: url)
            NSApp.activate()
        }
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: 10) {
            UmiMark(size: 30)
            Text("Umi").font(.system(size: 20, weight: .bold, design: .rounded))
            Spacer()
            Button { onboardingStep = 1 } label: { Image(systemName: "questionmark.circle") }
                .help("Show the tour")
            Button { openLibrary() } label: { Image(systemName: "film.stack") }
                .help("Library")
            Menu {
                Toggle("3-second countdown", isOn: Binding(get: { recorder.settings.countdown }, set: { recorder.settings.countdown = $0 }))
                Divider()
                Text("Start / Stop  \(HotKeys.Action.startStop.display)")
                Text("Pause / Resume  \(HotKeys.Action.pauseResume.display)")
                Text("Cancel  \(HotKeys.Action.cancel.display)")
                Divider()
                Button("Quit Umi") { NSApp.terminate(nil) }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .font(.system(size: 17))
        .buttonStyle(.borderless)
        .foregroundStyle(.primary)
    }

    @ViewBuilder
    private var setup: some View {
        let highlight = onboardingStep == OnboardingStep.settings.rawValue
        VStack(spacing: 10) {
            sourceRow
            cameraRow
            micRow
            systemAudioRow
        }
        .overlay {
            if highlight {
                RoundedRectangle(cornerRadius: 16).strokeBorder(Color.umiAccent.opacity(0.8), lineWidth: 2).padding(-5)
                    .shadow(color: .umiAccent.opacity(0.5), radius: 8)
            }
        }

        Button {
            closeLauncher()
            recorder.start()
        } label: {
            Text("Start recording")
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(Color.umiAccent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
                .shadow(color: onboardingStep == OnboardingStep.ready.rawValue ? .umiAccent.opacity(0.7) : .clear, radius: 10)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.defaultAction)

        HStack {
            Text("No time limit · Free forever")
            Spacer()
            Text(HotKeys.Action.startStop.display)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    private var sourceRow: some View {
        Menu {
            Section("Screen") {
                ForEach(recorder.displays, id: \.displayID) { display in
                    Button(display.menuTitle) {
                        recorder.settings.mode = .display
                        recorder.settings.displayID = display.displayID
                    }
                }
            }
            Section("Window") {
                ForEach(recorder.windows, id: \.windowID) { window in
                    Button(window.menuTitle) {
                        recorder.settings.mode = .window
                        recorder.settings.windowID = window.windowID
                    }
                }
            }
        } label: {
            LauncherRow(systemImage: recorder.settings.mode == .display ? "display" : "macwindow", title: sourceTitle)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }

    private var cameraRow: some View {
        HStack(spacing: 8) {
            cameraToggle
            if recorder.settings.showCamera {
                Button {
                    // macOS's own Video Effects panel: Center Stage, Portrait, Studio Light, backgrounds…
                    AVCaptureDevice.showSystemUserInterface(.videoEffects)
                } label: {
                    Image(systemName: "wand.and.stars")
                        .font(.system(size: 16, weight: .medium))
                        .frame(width: 54, height: 54)
                        .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .help("Video effects (Portrait, Studio Light, Center Stage…)")
            }
        }
    }

    private var cameraToggle: some View {
        Button {
            recorder.settings.showCamera.toggle()
            recorder.setCameraPreview(recorder.settings.showCamera)
        } label: {
            LauncherRow(systemImage: recorder.settings.showCamera ? "video" : "video.slash",
                        title: recorder.settings.showCamera ? (AVCaptureDevice.default(for: .video)?.localizedName ?? "Camera") : "No camera",
                        isOn: recorder.settings.showCamera)
        }
        .buttonStyle(.plain)
        .help("Turn the camera bubble on or off")
    }

    private var micRow: some View {
        Menu {
            Button("No microphone") {
                recorder.settings.captureMicrophone = false
                mic.stop()
            }
            Divider()
            ForEach(microphones, id: \.uniqueID) { device in
                Button(device.localizedName) {
                    recorder.settings.captureMicrophone = true
                    recorder.settings.microphoneID = device.uniqueID
                    mic.stop()
                    mic.start(deviceID: device.uniqueID)
                }
            }
        } label: {
            LauncherRow(systemImage: recorder.settings.captureMicrophone ? "mic" : "mic.slash",
                        title: recorder.settings.captureMicrophone ? micName : "No microphone",
                        isOn: recorder.settings.captureMicrophone,
                        level: recorder.settings.captureMicrophone ? mic.level : nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }

    private var systemAudioRow: some View {
        Button {
            recorder.settings.captureSystemAudio.toggle()
        } label: {
            LauncherRow(systemImage: recorder.settings.captureSystemAudio ? "speaker.wave.2" : "speaker.slash",
                        title: "System audio", isOn: recorder.settings.captureSystemAudio, compact: true)
        }
        .buttonStyle(.plain)
        .help("Record sound playing on your Mac")
    }

    private var active: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle().fill(recorder.phase == .paused ? .orange : .red).frame(width: 10, height: 10)
                TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                    Text(recorder.elapsed.formattedDuration)
                        .font(.system(size: 28, weight: .semibold, design: .monospaced))
                }
            }
            HStack {
                if recorder.phase == .paused {
                    Button { recorder.resume() } label: { Label("Resume", systemImage: "play.fill") }
                } else {
                    Button { recorder.pause() } label: { Label("Pause", systemImage: "pause.fill") }
                }
                Button { recorder.stop() } label: { Label("Stop", systemImage: "stop.fill") }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
            }
            HStack {
                Button("Restart") { recorder.restart() }
                Button("Discard", role: .destructive) { recorder.cancel() }
            }
            .buttonStyle(.borderless)
            .font(.caption)
        }
    }

    private func status(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage).foregroundStyle(.secondary)
    }

    // MARK: Helpers

    private var sourceTitle: String {
        switch recorder.settings.mode {
        case .display:
            if recorder.displays.count <= 1 { return "Full Screen" }
            return recorder.displays.first { $0.displayID == recorder.settings.displayID }?.menuTitle ?? "Full Screen"
        case .window:
            return recorder.windows.first { $0.windowID == recorder.settings.windowID }?.menuTitle ?? "Window"
        }
    }

    private var micName: String {
        microphones.first { $0.uniqueID == recorder.settings.microphoneID }?.localizedName
            ?? AVCaptureDevice.default(for: .audio)?.localizedName ?? "Microphone"
    }

    private func advanceTour() {
        let next = onboardingStep + 1
        onboardingStep = OnboardingStep(rawValue: next) == nil ? OnboardingStep.done : next
    }

    private func openLibrary() {
        openWindow(id: WindowID.library)
        NSApp.activate()
    }

    /// Closes the menu bar panel so it isn't in the way when recording starts.
    private func closeLauncher() {
        NSApp.windows.first { $0.isVisible && String(describing: type(of: $0)).contains("MenuBarExtra") }?.orderOut(nil)
    }
}

/// One rounded setting row in the launcher (Loom style), with an optional On/Off pill
/// and an optional input level bar along the bottom.
private struct LauncherRow: View {
    let systemImage: String
    let title: String
    var isOn: Bool?
    var level: Double?
    var compact = false
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: compact ? 15 : 18, weight: .medium))
                .frame(width: 26)
            Text(title)
                .font(.system(size: compact ? 13 : 15, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 8)
            if let isOn {
                Text(isOn ? "On" : "Off")
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(isOn ? Color.green.opacity(0.22) : Color.secondary.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(isOn ? Color.green.opacity(0.5) : .clear))
                    .foregroundStyle(isOn ? Color.green : .secondary)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: compact ? 40 : 54)
        .frame(maxWidth: .infinity)
        .background(alignment: .bottomLeading) {
            if let level {
                GeometryReader { geo in
                    Rectangle()
                        .fill(Color.umiAccent.opacity(0.35))
                        .frame(width: geo.size.width * level, height: 6)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .animation(.linear(duration: 0.08), value: level)
                }
            }
        }
        .background(Color.primary.opacity(hovering ? 0.11 : 0.07))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .contentShape(RoundedRectangle(cornerRadius: 14))
        .onHover { hovering = $0 }
    }
}

/// Umi's app mark: a rounded square in the Umay gradient with a record dot.
struct UmiMark: View {
    var size: CGFloat = 28

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.26)
            .fill(LinearGradient(colors: [Color(red: 1, green: 0.45, blue: 0.62), Color(red: 0.45, green: 0.62, blue: 1)],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
            .overlay(Circle().fill(.white).frame(width: size * 0.38, height: size * 0.38))
    }
}

extension Color {
    /// Umi's accent: a warm coral pink.
    static let umiAccent = Color(red: 0.98, green: 0.36, blue: 0.47)
}

extension SCDisplay {
    var menuTitle: String {
        let name = NSScreen.screens.first { $0.displayID == displayID }?.localizedName ?? "Display"
        return "\(name) (\(width)×\(height))"
    }
}

extension SCWindow {
    var menuTitle: String {
        let app = owningApplication?.applicationName ?? "Unknown"
        if let title, !title.isEmpty { return "\(app) — \(title)" }
        return app
    }
}

extension NSScreen {
    var displayID: CGDirectDisplayID? {
        deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
    }
}

extension TimeInterval {
    var formattedDuration: String {
        let total = Int(self)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}
