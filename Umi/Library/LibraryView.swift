import AVKit
import SwiftUI

struct LibraryView: View {
    @Environment(RecordingsLibrary.self) private var library
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        @Bindable var library = library

        NavigationSplitView {
            List(library.recordings, selection: $library.selection) { recording in
                RecordingRow(recording: recording)
                    .contextMenu {
                        Button("Edit") { openWindow(id: WindowID.editor, value: recording.url) }
                        Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([recording.url]) }
                        Divider()
                        Button("Move to Trash", role: .destructive) { library.moveToTrash(recording) }
                    }
            }
            .contextMenu(forSelectionType: Recording.ID.self) { _ in } primaryAction: { ids in
                ids.forEach { openWindow(id: WindowID.editor, value: $0) }
            }
            .navigationSplitViewColumnWidth(min: 240, ideal: 280)
            .overlay {
                if library.recordings.isEmpty {
                    ContentUnavailableView("No recordings yet", systemImage: "record.circle", description: Text("Start a recording from the Umi icon in the menu bar."))
                }
            }
        } detail: {
            if let recording = library.recordings.first(where: { $0.id == library.selection }) {
                RecordingDetail(recording: recording)
            } else {
                ContentUnavailableView("Select a recording", systemImage: "film")
            }
        }
        .toolbar {
            Button { library.reload() } label: { Image(systemName: "arrow.clockwise") }
                .help("Reload")
        }
        .onAppear { library.reload() }
    }
}

private struct RecordingRow: View {
    let recording: Recording
    @State private var thumbnail: NSImage?
    @State private var duration: TimeInterval?

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(.quaternary)
                if let thumbnail {
                    Image(nsImage: thumbnail).resizable().aspectRatio(contentMode: .fill)
                }
            }
            .frame(width: 80, height: 50)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 2) {
                Text(recording.createdAt, format: .dateTime.day().month().hour().minute())
                    .font(.body.weight(.medium))
                if let duration {
                    Text(duration.formattedDuration).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
        .task(id: recording.url) { await load() }
    }

    private func load() async {
        duration = recording.project.duration
        let asset = AVURLAsset(url: recording.screenURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 320, height: 200)
        if let (image, _) = try? await generator.image(at: CMTime(seconds: 0.5, preferredTimescale: 600)) {
            thumbnail = NSImage(cgImage: image, size: .zero)
        }
    }
}

private struct RecordingDetail: View {
    let recording: Recording
    @Environment(\.openWindow) private var openWindow
    @State private var thumbnail: NSImage?

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(.quaternary)
                if let thumbnail {
                    Image(nsImage: thumbnail).resizable().aspectRatio(contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onTapGesture(count: 2) { edit() }

            HStack {
                VStack(alignment: .leading) {
                    Text(recording.title).font(.headline).lineLimit(1)
                    Text(recording.project.duration.formattedDuration).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Show in Finder", systemImage: "folder") {
                    NSWorkspace.shared.activateFileViewerSelecting([recording.url])
                }
                Button("Edit", systemImage: "slider.horizontal.3") { edit() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .task(id: recording.url) {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: recording.screenURL))
            generator.maximumSize = CGSize(width: 1600, height: 1000)
            thumbnail = (try? await generator.image(at: CMTime(seconds: 0.5, preferredTimescale: 600))).map { NSImage(cgImage: $0.image, size: .zero) }
        }
    }

    private func edit() {
        openWindow(id: WindowID.editor, value: recording.url)
    }
}
