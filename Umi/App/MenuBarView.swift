import ScreenCaptureKit
import SwiftUI

struct MenuBarLabel: View {
    @Environment(RecordingController.self) private var recorder

    var body: some View {
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

struct MenuBarView: View {
    @Environment(RecordingController.self) private var recorder
    @Environment(RecordingsLibrary.self) private var library
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        @Bindable var recorder = recorder

        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Umi").font(.headline)
                Spacer()
                Button {
                    openLibrary()
                } label: {
                    Image(systemName: "film.stack")
                }
                .buttonStyle(.borderless)
                .help("Open library")
            }

            switch recorder.phase {
            case .idle:
                setupSection(settings: $recorder.settings)
            case .countingDown:
                Text("Starting…").foregroundStyle(.secondary)
                Button("Cancel", role: .cancel) { recorder.cancel() }
            case .recording, .paused:
                activeSection
            case .finishing:
                ProgressView("Saving recording…")
            }

            if let error = recorder.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()
            Button("Quit Umi") { NSApp.terminate(nil) }
                .buttonStyle(.borderless)
        }
        .padding(14)
        .frame(width: 300)
        .task { await recorder.refreshSources() }
        .onChange(of: recorder.lastFinishedURL) { _, url in
            guard let url else { return }
            library.reload(selecting: url)
            openLibrary()
        }
    }

    @ViewBuilder
    private func setupSection(settings: Binding<RecordingSettings>) -> some View {
        Picker("Record", selection: settings.mode) {
            Text("Screen").tag(CaptureMode.display)
            Text("Window").tag(CaptureMode.window)
        }
        .pickerStyle(.segmented)
        .labelsHidden()

        switch settings.wrappedValue.mode {
        case .display:
            Picker("Display", selection: settings.displayID) {
                ForEach(recorder.displays, id: \.displayID) { display in
                    Text(display.menuTitle).tag(Optional(display.displayID))
                }
            }
        case .window:
            Picker("Window", selection: settings.windowID) {
                ForEach(recorder.windows, id: \.windowID) { window in
                    Text(window.menuTitle).lineLimit(1).tag(Optional(window.windowID))
                }
            }
        }

        Toggle("Camera bubble", isOn: settings.showCamera)
            .onChange(of: settings.wrappedValue.showCamera) { _, on in
                recorder.setCameraPreview(on)
            }
        Toggle("Microphone", isOn: settings.captureMicrophone)
        Toggle("System audio", isOn: settings.captureSystemAudio)
        Toggle("3-second countdown", isOn: settings.countdown)

        Button {
            recorder.start()
        } label: {
            Label("Start Recording", systemImage: "record.circle.fill")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)
        .controlSize(.large)
        .keyboardShortcut(.defaultAction)
    }

    private var activeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Text(recorder.elapsed.formattedDuration)
                    .font(.system(size: 28, weight: .semibold, design: .monospaced))
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

    private func openLibrary() {
        openWindow(id: WindowID.library)
        NSApp.activate()
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
