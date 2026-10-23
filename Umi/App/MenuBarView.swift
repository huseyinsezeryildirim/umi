import AVFoundation
import ScreenCaptureKit
import SwiftUI

/// The launcher: pick what to record, check camera and mic, start.
struct MenuBarView: View {
    @Environment(RecordingController.self) private var recorder
    @State private var mic = MicLevelMonitor()
    @State private var microphones: [AVCaptureDevice] = []
    @AppStorage("onboardingStep") private var onboardingStep = 0
    @State private var showCameraSettings = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header

            if !recorder.hasScreenPermission, recorder.phase == .idle {
                PermissionCard(recorder: recorder)
            }

            switch recorder.phase {
            case .idle where showCameraSettings:
                CameraSettingsView(recorder: recorder) { withAnimation(.smooth(duration: 0.25)) { showCameraSettings = false } }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
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
                    .font(.system(size: 12))
                    .foregroundStyle(UmiTheme.record)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .frame(width: 344)
        .background(UmiTheme.iceWash)
        .foregroundStyle(UmiTheme.body)
        .environment(\.colorScheme, .light)
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
    }

    // MARK: Sections

    private var header: some View {
        HStack(spacing: 8) {
            UmiMark(size: 28)
            Text("Umi")
                .font(.system(size: 19, weight: .bold))
                .tracking(-0.4)
                .foregroundStyle(UmiTheme.ink)
            Spacer()
            Button { AppModel.shared.startTour() } label: { Image(systemName: "questionmark") }
                .buttonStyle(GlassIconButtonStyle())
                .help("Show the tour")
            Button { openLibrary() } label: { Image(systemName: "film.stack") }
                .buttonStyle(GlassIconButtonStyle())
                .help("Library")
            Menu {
                Toggle("3-second countdown", isOn: Binding(get: { recorder.settings.countdown }, set: { recorder.settings.countdown = $0 }))
                Divider()
                Text("Start / Stop  \(HotKeys.Action.startStop.display)")
                Text("Pause / Resume  \(HotKeys.Action.pauseResume.display)")
                Text("Cancel  \(HotKeys.Action.cancel.display)")
                Text("Open Umi  \(HotKeys.Action.launcher.display)")
                Divider()
                Button("Quit Umi") { NSApp.terminate(nil) }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(UmiTheme.secondary)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(.white.shadow(.inner(color: UmiTheme.innerGlow, radius: 3, x: -1, y: -1))))
                    .overlay(Circle().strokeBorder(Color(hex: 0xD0D5DF)))
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
        }
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
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(UmiTheme.ringLit, lineWidth: 2)
                    .padding(-6)
                    .shadow(color: UmiTheme.accent.opacity(0.25), radius: 10)
            }
        }

        Button {
            closeLauncher()
            recorder.start()
        } label: {
            HStack(spacing: 9) {
                Circle().fill(UmiTheme.record).frame(width: 9, height: 9)
                Text("Start recording")
            }
        }
        .buttonStyle(InkButtonStyle())
        .shadow(color: onboardingStep == OnboardingStep.ready.rawValue ? UmiTheme.accent.opacity(0.45) : .clear, radius: 14)
        .keyboardShortcut(.defaultAction)

        HStack {
            Text("No time limit · Free forever")
            Spacer()
            Text("\(HotKeys.Action.startStop.display) to start")
        }
        .font(.system(size: 12))
        .foregroundStyle(UmiTheme.tertiary)
        .frame(maxWidth: .infinity)
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
                    withAnimation(.smooth(duration: 0.25)) { showCameraSettings = true }
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(UmiTheme.secondary)
                }
                .buttonStyle(GlassButtonStyle(height: 54, cornerRadius: 16))
                .help("Camera settings")
            }
        }
    }

    private var cameraToggle: some View {
        Button {
            recorder.settings.showCamera.toggle()
            recorder.setCameraPreview(recorder.settings.showCamera)
        } label: {
            LauncherRow(systemImage: recorder.settings.showCamera ? "video" : "video.slash",
                        title: recorder.settings.showCamera ? (recorder.selectedCamera?.localizedName ?? "Camera") : "No camera",
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

    private func openLibrary() {
        AppModel.shared.closeLauncher()
        AppModel.shared.openLibrary()
    }

    /// Closes the launcher so it isn't in the way when recording starts.
    private func closeLauncher() {
        AppModel.shared.closeLauncher()
    }
}

/// Camera settings, shown inside the launcher: device, bubble shape/size/mirror,
/// Center Stage, and a way into macOS's own video effects.
private struct CameraSettingsView: View {
    let recorder: RecordingController
    let back: () -> Void
    @State private var cameras: [AVCaptureDevice] = []

    var body: some View {
        let style = recorder.cameraBubble.style
        VStack(alignment: .leading, spacing: 14) {
            Button(action: back) {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
                    Text("Camera").font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(UmiTheme.ink)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            UmiCard(.small, padding: 14) {
                VStack(alignment: .leading, spacing: 14) {
                    SettingLabel("Camera")
                    Menu {
                        ForEach(cameras, id: \.uniqueID) { device in
                            Button(device.localizedName) { recorder.selectCamera(device.uniqueID) }
                        }
                    } label: {
                        HStack {
                            Text(recorder.selectedCamera?.localizedName ?? "Camera")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(UmiTheme.body)
                                .lineLimit(1)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(UmiTheme.tertiary)
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(UmiTheme.track.opacity(0.6)))
                        .contentShape(Rectangle())
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)

                    SettingLabel("Shape")
                    Segmented(options: EditSettings.Camera.Shape.allCases, selection: style.shape, label: { $0.rawValue.capitalized }) {
                        recorder.setCameraShape($0)
                    }

                    SettingLabel("Size")
                    Segmented(options: CameraBubbleStyle.Size.allCases, selection: CameraBubbleStyle.Size.allCases.min { abs($0.diameter - style.diameter) < abs($1.diameter - style.diameter) } ?? .medium,
                              label: { $0.rawValue.capitalized }) {
                        recorder.setCameraSize($0)
                    }

                    ToggleRow(title: "Mirror", isOn: style.mirrored) { recorder.toggleCameraMirror() }
                    if recorder.supportsCenterStage {
                        ToggleRow(title: "Center Stage", subtitle: "Keeps you in frame as you move", isOn: recorder.centerStageEnabled) {
                            recorder.centerStageEnabled.toggle()
                        }
                    }
                }
            }

            Button {
                // macOS's own panel (Portrait, Studio Light, backgrounds) opens under the menu
                // bar; close the launcher first so it isn't hidden behind it. The camera stays
                // on: macOS only offers effects for a camera in use, and the bubble shows them.
                AppModel.shared.closeLauncherKeepingCamera()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    AVCaptureDevice.showSystemUserInterface(.videoEffects)
                }
            } label: {
                HStack {
                    Image(systemName: "sparkles")
                    VStack(alignment: .leading, spacing: 1) {
                        Text("More video effects").font(.system(size: 14, weight: .medium))
                        Text("Portrait, Studio Light, backgrounds (macOS)").font(.system(size: 11.5)).foregroundStyle(UmiTheme.tertiary)
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(UmiTheme.tertiary)
                }
                .foregroundStyle(UmiTheme.body)
                .padding(.horizontal, 14)
                .frame(height: 52)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white).shadow(color: .black.opacity(0.04), radius: 2, y: 1))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(UmiTheme.cardBorder))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .onAppear { cameras = CaptureDevices.cameras }
    }
}

private struct SettingLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.system(size: 12, weight: .medium)).foregroundStyle(UmiTheme.tertiary)
    }
}

/// A light segmented control: a track with a white raised pill on the selection.
private struct Segmented<Option: Hashable>: View {
    let options: [Option]
    let selection: Option
    let label: (Option) -> String
    let select: (Option) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                Button { select(option) } label: {
                    Text(label(option))
                        .font(.system(size: 13, weight: option == selection ? .semibold : .regular))
                        .foregroundStyle(option == selection ? UmiTheme.ink : UmiTheme.secondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 30)
                        .background {
                            if option == selection {
                                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.white)
                                    .shadow(color: .black.opacity(0.1), radius: 1.5, y: 1)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(UmiTheme.track))
        .animation(.snappy(duration: 0.2), value: selection)
    }
}

private struct ToggleRow: View {
    let title: String
    var subtitle: String?
    let isOn: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 14, weight: .medium)).foregroundStyle(UmiTheme.body)
                    if let subtitle { Text(subtitle).font(.system(size: 11.5)).foregroundStyle(UmiTheme.tertiary) }
                }
                Spacer()
                GlassSwitch(isOn: isOn)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Shown until Screen Recording is allowed. macOS's own prompt appears only once;
/// this card covers the rest, including the relaunch macOS needs after granting.
private struct PermissionCard: View {
    let recorder: RecordingController

    var body: some View {
        UmiCard(.small, padding: 16, highlighted: true) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(UmiTheme.accent)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(Color(hex: 0xE8EFFC)))
                    Text("Allow screen recording")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(UmiTheme.ink)
                }
                Text("Turn on Umi in System Settings › Privacy & Security › Screen & System Audio Recording, then relaunch Umi.")
                    .font(.system(size: 13))
                    .lineSpacing(2)
                    .foregroundStyle(UmiTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 14) {
                    Button("Open Settings") { recorder.requestScreenPermission() }
                        .buttonStyle(GlassButtonStyle(height: 36, cornerRadius: 12))
                    Button("Relaunch Umi") { recorder.relaunch() }
                        .buttonStyle(LinkButtonStyle())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One setting row in the launcher: a white card with an icon, a title, a switch and
/// an optional input-level line along the bottom.
private struct LauncherRow: View {
    let systemImage: String
    let title: String
    var isOn: Bool?
    var level: Double?
    var compact = false
    @State private var hovering = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: compact ? 14 : 16, weight: .medium))
                .foregroundStyle(isOn == false ? UmiTheme.tertiary : UmiTheme.ink)
                .frame(width: 24)
            Text(title)
                .font(.system(size: compact ? 13.5 : 15, weight: .medium))
                .foregroundStyle(isOn == false ? UmiTheme.tertiary : UmiTheme.body)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 8)
            if let isOn {
                GlassSwitch(isOn: isOn)
            } else {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(UmiTheme.tertiary)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: compact ? 44 : 54)
        .frame(maxWidth: .infinity)
        .background(shape.fill(.white).shadow(color: .black.opacity(hovering ? 0.08 : 0.04), radius: hovering ? 6 : 2, y: 1))
        .overlay(alignment: .bottom) {
            if let level {
                GeometryReader { geo in
                    Capsule()
                        .fill(LinearGradient(colors: [UmiTheme.accentLight, UmiTheme.accent], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(geo.size.width * level, 3), height: 3)
                        .animation(.linear(duration: 0.08), value: level)
                }
                .frame(height: 3)
                .padding(.horizontal, 16)
                .padding(.bottom, 6)
            }
        }
        .overlay(shape.strokeBorder(hovering ? UmiTheme.ringLit : UmiTheme.cardBorder))
        .contentShape(shape)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
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
