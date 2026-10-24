import AVKit
import SwiftUI

struct EditorView: View {
    @State private var model: EditorModel
    @State private var showExport = false
    @State private var showCrop = false
    @Environment(\.undoManager) private var undoManager

    init(bundle: URL) {
        _model = State(initialValue: EditorModel(bundle: bundle))
    }

    var body: some View {
        HSplitView {
            // Drag the divider to trade preview size for timeline space.
            VSplitView {
                VStack(spacing: 0) {
                    PreviewToolbar(model: model, showCrop: $showCrop)
                    PlayerSurface(player: model.player)
                        .background(Color.black.opacity(0.9))
                        .overlay { PreviewOverlay(model: model) }
                        .frame(minWidth: 560, minHeight: 260)
                    TransportBar(model: model)
                }
                EditorTimeline(model: model)
                    .frame(minHeight: 180, idealHeight: 290, maxHeight: 560)
            }
            .background(EditorKeys(model: model))
            InspectorView(model: model)
                .frame(minWidth: 280, idealWidth: 310, maxWidth: 380)
        }
        .navigationTitle(model.bundle.deletingPathExtension().lastPathComponent)
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                PresetsMenu(model: model)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { undoManager?.undo() } label: { Image(systemName: "arrow.uturn.backward") }
                    .help("Undo (⌘Z)")
                    .disabled(!(undoManager?.canUndo ?? false))
                Button { undoManager?.redo() } label: { Image(systemName: "arrow.uturn.forward") }
                    .help("Redo (⇧⌘Z)")
                    .disabled(!(undoManager?.canRedo ?? false))
                Button {
                    showExport = true
                } label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.borderedProminent)
                .tint(UmiTheme.accent)
                .help("Export the video")
            }
        }
        .sheet(isPresented: $showExport) { ExportSheet(model: model) }
        .sheet(isPresented: $showCrop) { CropSheet(model: model) }
        .overlay(alignment: .top) {
            if let error = model.loadError {
                Text(error)
                    .padding(8)
                    .background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(.white)
                    .padding()
            }
        }
        .onAppear { model.undoManager = undoManager }
        .onChange(of: undoManager) { _, manager in model.undoManager = manager }
        .onDisappear { model.player.pause() }
    }
}

/// AVPlayerView without the system controls; the editor draws its own transport.
private struct PlayerSurface: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .none
        view.videoGravity = .resizeAspect
        view.player = player
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player { view.player = player }
    }
}

/// Above the preview: aspect ratio, crop, device frame and preview quality.
private struct PreviewToolbar: View {
    let model: EditorModel
    @Binding var showCrop: Bool

    var body: some View {
        HStack(spacing: 14) {
            Menu {
                ForEach(EditSettings.AspectRatio.allCases, id: \.self) { aspect in
                    Button {
                        model.update { $0.aspect = aspect }
                    } label: {
                        if model.edit.aspect == aspect { Label(aspect.label, systemImage: "checkmark") } else { Text(aspect.label) }
                    }
                }
            } label: {
                Label(model.edit.aspect == .auto ? "Auto" : model.edit.aspect.label.components(separatedBy: " ").first ?? "", systemImage: "aspectratio")
            }
            .fixedSize()
            .help("Aspect ratio")

            Button { showCrop = true } label: {
                Label(model.edit.crop == nil ? "Crop" : "Cropped", systemImage: "crop")
            }
            .help("Crop the recording")

            Menu {
                ForEach(EditSettings.DeviceFrame.allCases, id: \.self) { frame in
                    Button {
                        model.update { $0.frame = frame }
                    } label: {
                        if model.edit.frame == frame { Label(frame.label, systemImage: "checkmark") } else { Text(frame.label) }
                    }
                }
            } label: {
                Label(model.edit.frame == .none ? "Frame" : model.edit.frame.label, systemImage: "macwindow")
            }
            .fixedSize()
            .help("Device frame")

            Spacer()

            Text("Preview quality").font(.caption).foregroundStyle(.secondary)
            Picker("", selection: Binding(get: { model.previewQuality }, set: { model.previewQuality = $0 })) {
                Text("Full").tag(1.0)
                Text("Half").tag(0.5)
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .fixedSize()
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.borderless)
        .font(.system(size: 12.5, weight: .medium))
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
    }
}

/// Time on the left, play controls in the middle, split and timeline zoom on the right.
private struct TransportBar: View {
    let model: EditorModel

    var body: some View {
        ZStack {
            HStack(spacing: 14) {
                Text("\(model.currentTime.formattedPrecise) / \(model.outputDuration.formattedPrecise)")
                    .font(.system(size: 13, weight: .medium).monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
                Button { model.split(at: model.currentTime) } label: { Image(systemName: "scissors") }
                    .help("Split at the playhead (S). Drag on the ruler to select a part to cut.")
                Divider().frame(height: 18)
                Button { model.timelineZoom = max(1, model.timelineZoom / 1.5) } label: { Image(systemName: "minus.magnifyingglass") }
                    .help("Zoom the timeline out")
                Slider(value: Binding(get: { model.timelineZoom }, set: { model.timelineZoom = $0 }), in: 1...12)
                    .frame(width: 110)
                    .controlSize(.small)
                Button { model.timelineZoom = min(12, model.timelineZoom * 1.5) } label: { Image(systemName: "plus.magnifyingglass") }
                    .help("Zoom the timeline in")
            }
            HStack(spacing: 18) {
                Button { model.seek(to: model.previousEdge()) } label: { Image(systemName: "backward.end.fill") }
                    .help("Previous cut or start")
                Button { model.togglePlay() } label: {
                    Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 38, height: 38)
                        .background(Circle().fill(Color.primary.opacity(0.08)))
                        .overlay(Circle().strokeBorder(Color.primary.opacity(0.15)))
                }
                .help("Play / Pause (Space)")
                Button { model.seek(to: model.nextEdge()) } label: { Image(systemName: "forward.end.fill") }
                    .help("Next cut or end")
            }
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
    }
}

/// Save the current look as a preset, apply one, or pick the default for new recordings.
private struct PresetsMenu: View {
    let model: EditorModel
    @State private var presets = StylePresets.all
    @State private var defaultID = StylePresets.defaultID

    var body: some View {
        Menu {
            if presets.isEmpty {
                Text("No presets yet")
            }
            ForEach(presets) { preset in
                Button {
                    model.update { preset.apply(to: &$0) }
                } label: {
                    Text(preset.name + (preset.id == defaultID ? "  (default)" : ""))
                }
            }
            Divider()
            Button("Save Current Look as Preset…") { save() }
            if !presets.isEmpty {
                Menu("Default for New Recordings") {
                    Button {
                        StylePresets.defaultID = nil
                        defaultID = nil
                    } label: { if defaultID == nil { Label("Umi Default", systemImage: "checkmark") } else { Text("Umi Default") } }
                    ForEach(presets) { preset in
                        Button {
                            StylePresets.defaultID = preset.id
                            defaultID = preset.id
                        } label: { if preset.id == defaultID { Label(preset.name, systemImage: "checkmark") } else { Text(preset.name) } }
                    }
                }
                Menu("Delete") {
                    ForEach(presets) { preset in
                        Button(preset.name, role: .destructive) {
                            presets.removeAll { $0.id == preset.id }
                            StylePresets.all = presets
                            if defaultID == preset.id { StylePresets.defaultID = nil; defaultID = nil }
                        }
                    }
                }
            }
        } label: {
            Label("Presets", systemImage: "wand.and.stars")
        }
        .help("Style presets")
    }

    private func save() {
        let alert = NSAlert()
        alert.messageText = "Save this look as a preset"
        alert.informativeText = "Background, frame, padding, corners, shadow, cursor, camera style and color grade."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.placeholderString = "Preset name"
        alert.accessoryView = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let name = field.stringValue.trimmingCharacters(in: .whitespaces)
        presets.append(StylePreset(name: name.isEmpty ? "Preset \(presets.count + 1)" : name, from: model.edit))
        StylePresets.all = presets
    }
}

private struct ExportSheet: View {
    let model: EditorModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("exportResolution") private var resolution = Exporter.Resolution.p1080.rawValue
    @AppStorage("exportFPS") private var fps = 60
    @AppStorage("exportFormat") private var format = Exporter.Format.mp4.rawValue

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Export").font(.title2.bold())

            Form {
                Picker("Resolution", selection: $resolution) {
                    ForEach(Exporter.Resolution.allCases) { Text($0.label).tag($0.rawValue) }
                }
                Picker("Frame rate", selection: $fps) {
                    Text("30 fps").tag(30)
                    Text("60 fps").tag(60)
                }
                Picker("Format", selection: $format) {
                    Text("MP4 (H.264)").tag(Exporter.Format.mp4.rawValue)
                    Text("MOV (H.264)").tag(Exporter.Format.mov.rawValue)
                    Text("GIF (15 fps, up to 540p)").tag(Exporter.Format.gif.rawValue)
                }
            }

            if let progress = model.exportProgress {
                ProgressView(value: progress) { Text("Exporting… \(Int(progress * 100))%") }
            } else if let url = model.lastExportURL {
                HStack {
                    Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    Spacer()
                    Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                    ShareLink(item: url)
                }
            }

            HStack {
                Spacer()
                Button("Close") { dismiss() }
                Button("Export") {
                    model.export(resolution: Exporter.Resolution(rawValue: resolution) ?? .p1080, fps: fps,
                                 format: Exporter.Format(rawValue: format) ?? .mp4)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.exportProgress != nil)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}

extension Double {
    /// 00:12.3
    var formattedPrecise: String {
        let total = max(self, 0)
        let minutes = Int(total) / 60
        let seconds = total - Double(minutes * 60)
        return String(format: "%02d:%04.1f", minutes, seconds)
    }
}

/// Editor shortcuts that work wherever focus is in the window (but not while typing in a
/// text field): Delete/Backspace removes the selection, Escape deselects, Space plays,
/// S splits and Z adds a zoom at the playhead.
private struct EditorKeys: NSViewRepresentable {
    let model: EditorModel

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        context.coordinator.install(on: view, model: model)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        private var monitor: Any?

        func install(on view: NSView, model: EditorModel) {
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak view] event in
                guard let window = view?.window, event.window === window else { return event }
                if window.firstResponder is NSTextView { return event } // typing in a field
                switch event.keyCode {
                case 51, 117: // Backspace, forward Delete: the selected item, or the selected span
                    guard model.selection != nil || model.rangeSelection != nil else { return event }
                    model.deleteSelection()
                    return nil
                case 53: // Escape
                    guard model.selection != nil || model.rangeSelection != nil else { return event }
                    model.selection = nil
                    model.rangeSelection = nil
                    return nil
                case 49 where event.modifierFlags.intersection([.command, .option, .control]).isEmpty: // Space
                    model.togglePlay()
                    return nil
                case 1 where event.modifierFlags.intersection([.command, .option, .control]).isEmpty: // S
                    model.split(at: model.currentTime)
                    return nil
                case 6 where event.modifierFlags.intersection([.command, .option, .control]).isEmpty: // Z
                    model.addZoom(at: model.currentTime)
                    return nil
                default:
                    return event
                }
            }
        }

        func uninstall() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }
}

