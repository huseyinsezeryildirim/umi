import AVKit
import SwiftUI

struct EditorView: View {
    @State private var model: EditorModel
    @State private var showExport = false
    @Environment(\.undoManager) private var undoManager

    init(bundle: URL) {
        _model = State(initialValue: EditorModel(bundle: bundle))
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                PlayerSurface(player: model.player)
                    .background(Color.black.opacity(0.9))
                    .overlay { PreviewOverlay(model: model) }
                    .frame(minWidth: 560, minHeight: 320)
                TransportBar(model: model)
                Divider()
                EditorTimeline(model: model)
                    .frame(minHeight: 150, idealHeight: 250)
            }
            InspectorView(model: model)
                .frame(minWidth: 280, idealWidth: 300, maxWidth: 360)
        }
        .navigationTitle(model.bundle.deletingPathExtension().lastPathComponent)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showExport = true
                } label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                }
                .help("Export as MP4")
            }
        }
        .sheet(isPresented: $showExport) {
            ExportSheet(model: model)
        }
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

private struct TransportBar: View {
    let model: EditorModel

    var body: some View {
        HStack(spacing: 14) {
            Button {
                model.togglePlay()
            } label: {
                Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
                    .frame(width: 18)
            }
            .keyboardShortcut(.space, modifiers: [])
            .help("Play / Pause (Space)")

            Text("\(model.currentTime.formattedPrecise) / \(model.outputDuration.formattedPrecise)")
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(.secondary)

            Spacer()

            Button {
                model.split(at: model.currentTime)
            } label: {
                Label("Split", systemImage: "scissors")
            }
            .keyboardShortcut("s", modifiers: [])
            .help("Split at playhead (S)")

            Button {
                model.addZoom(at: model.currentTime)
            } label: {
                Label("Add Zoom", systemImage: "plus.magnifyingglass")
            }
            .keyboardShortcut("z", modifiers: [])
            .help("Add a zoom at the playhead (Z)")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }
}

private struct ExportSheet: View {
    let model: EditorModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("exportResolution") private var resolution = Exporter.Resolution.p1080.rawValue
    @AppStorage("exportFPS") private var fps = 60

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
                LabeledContent("Format", value: "MP4 (H.264)")
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
                    model.export(resolution: Exporter.Resolution(rawValue: resolution) ?? .p1080, fps: fps)
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
