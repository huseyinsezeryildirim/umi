import AVFoundation
import Observation
import SwiftUI

/// One track in the built-in music library: public-domain (CC0) music from the FreePD
/// archive, downloaded on first use and cached.
struct LibraryTrack: Codable, Hashable, Identifiable {
    var title: String
    var category: String
    var seconds: Int
    var bytes: Int
    var url: URL

    var id: URL { url }
}

/// The catalog (bundled JSON), the download cache and the preview player.
@Observable
final class MusicLibrary {
    static let shared = MusicLibrary()

    let tracks: [LibraryTrack]
    var categories: [String] { tracks.reduce(into: [String]()) { if !$0.contains($1.category) { $0.append($1.category) } } }

    private(set) var downloading: Set<URL> = []
    private(set) var previewing: URL?
    private(set) var failed: URL?
    private let player = AVPlayer()
    private var endObserver: Any?

    private init() {
        tracks = Bundle.main.url(forResource: "MusicLibrary", withExtension: "json")
            .flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? JSONDecoder().decode([LibraryTrack].self, from: $0) } ?? []
    }

    /// ~/Library/Application Support/Umi/Music
    private var cacheFolder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Umi/Music", isDirectory: true)
    }

    func localURL(for track: LibraryTrack) -> URL {
        cacheFolder.appendingPathComponent(track.url.lastPathComponent.removingPercentEncoding ?? track.url.lastPathComponent)
    }

    func isDownloaded(_ track: LibraryTrack) -> Bool {
        FileManager.default.fileExists(atPath: localURL(for: track).path)
    }

    /// The cached file, downloading it first if needed.
    func file(for track: LibraryTrack) async throws -> URL {
        let local = localURL(for: track)
        if FileManager.default.fileExists(atPath: local.path) { return local }
        downloading.insert(track.url)
        failed = nil
        defer { downloading.remove(track.url) }
        do {
            let (temp, response) = try await URLSession.shared.download(from: track.url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            try FileManager.default.createDirectory(at: cacheFolder, withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: local)
            try FileManager.default.moveItem(at: temp, to: local)
            return local
        } catch {
            failed = track.url
            throw error
        }
    }

    /// Plays a track (streamed, or from the cache) to try it out; again stops it.
    func togglePreview(_ track: LibraryTrack) {
        if previewing == track.url {
            stopPreview()
            return
        }
        let source = isDownloaded(track) ? localURL(for: track) : track.url
        let item = AVPlayerItem(url: source)
        player.replaceCurrentItem(with: item)
        player.play()
        previewing = track.url
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.previewing = nil }
        }
    }

    func stopPreview() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        previewing = nil
    }
}

/// Browse, preview and pick a library track.
struct MusicLibrarySheet: View {
    let model: EditorModel
    @Environment(\.dismiss) private var dismiss
    @State private var category: String?
    @State private var search = ""
    @State private var error: String?
    private let library = MusicLibrary.shared

    private var shown: [LibraryTrack] {
        library.tracks.filter { track in
            (category == nil || track.category == category)
                && (search.isEmpty || track.title.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Music Library").font(.title2.bold())
                Spacer()
                TextField("Search", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 180)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    chip("All", selected: category == nil) { category = nil }
                    ForEach(library.categories, id: \.self) { c in
                        chip(c, selected: category == c) { category = c }
                    }
                }
            }
            List(shown) { track in
                row(track)
            }
            .listStyle(.inset)
            .frame(height: 380)
            HStack {
                Text("Public-domain music (CC0) from FreePD. Free for any use, no credit needed.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(UmiTheme.record)
            }
        }
        .padding(20)
        .frame(width: 560)
        .onDisappear { library.stopPreview() }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(Capsule().fill(selected ? UmiTheme.accent : Color.secondary.opacity(0.12)))
                .foregroundStyle(selected ? .white : .primary)
        }
        .buttonStyle(.plain)
    }

    private func row(_ track: LibraryTrack) -> some View {
        let playing = library.previewing == track.url
        let busy = library.downloading.contains(track.url)
        let current = model.edit.music?.title == track.title
        return HStack(spacing: 10) {
            Button { library.togglePreview(track) } label: {
                Image(systemName: playing ? "stop.fill" : "play.fill")
                    .frame(width: 26, height: 26)
                    .background(Circle().fill(playing ? UmiTheme.accent : Color.secondary.opacity(0.14)))
                    .foregroundStyle(playing ? .white : .primary)
            }
            .buttonStyle(.plain)
            .help(playing ? "Stop" : "Listen")
            VStack(alignment: .leading, spacing: 1) {
                Text(track.title).font(.system(size: 13, weight: .medium))
                Text("\(track.category) · \(Double(track.seconds).formattedDuration)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if busy {
                ProgressView().controlSize(.small)
            } else if current {
                Label("In use", systemImage: "checkmark").font(.caption).foregroundStyle(UmiTheme.accent)
            } else {
                Button(library.isDownloaded(track) ? "Use" : "Download & Use") { use(track) }
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 2)
    }

    private func use(_ track: LibraryTrack) {
        error = nil
        Task {
            do {
                let file = try await library.file(for: track)
                library.stopPreview()
                model.setMusic(file, title: track.title)
                dismiss()
            } catch {
                self.error = "Couldn't download \(track.title): \(error.localizedDescription)"
            }
        }
    }
}
