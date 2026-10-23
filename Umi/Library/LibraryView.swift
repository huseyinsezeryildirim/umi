import AVKit
import SwiftUI

struct LibraryView: View {
    @Environment(RecordingsLibrary.self) private var library

    var body: some View {
        @Bindable var library = library

        NavigationSplitView {
            List(library.recordings, selection: $library.selection) { recording in
                RecordingRow(recording: recording)
                    .contextMenu {
                        Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([recording.url]) }
                        Divider()
                        Button("Move to Trash", role: .destructive) { library.moveToTrash(recording) }
                    }
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
    @State private var player = AVPlayer()

    var body: some View {
        VStack(spacing: 0) {
            VideoPlayer(player: player)
                .background(.black)
            HStack {
                Text(recording.title).font(.headline).lineLimit(1)
                Spacer()
                Button("Show in Finder", systemImage: "folder") {
                    NSWorkspace.shared.activateFileViewerSelecting([recording.url])
                }
                ShareLink(item: recording.url) {
                    Label("Share File", systemImage: "square.and.arrow.up")
                }
            }
            .padding(12)
        }
        .onChange(of: recording.url, initial: true) { _, url in
            player.replaceCurrentItem(with: AVPlayerItem(url: recording.screenURL))
        }
        .onDisappear { player.pause() }
    }
}
