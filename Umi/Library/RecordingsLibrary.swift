import AVFoundation
import Observation

struct Recording: Identifiable, Hashable {
    let url: URL
    let createdAt: Date
    var id: URL { url }
    var title: String { url.deletingPathExtension().lastPathComponent }
}

/// The recordings saved in ~/Movies/Umi.
@Observable
final class RecordingsLibrary {
    private(set) var recordings: [Recording] = []
    var selection: Recording.ID?

    init() { reload() }

    static func folderURL() throws -> URL {
        let movies = try FileManager.default.url(for: .moviesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let folder = movies.appendingPathComponent("Umi", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    static func newRecordingURL() throws -> URL {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        return try folderURL().appendingPathComponent("Umi \(formatter.string(from: Date()))").appendingPathExtension("mov")
    }

    func reload(selecting url: URL? = nil) {
        guard let folder = try? Self.folderURL(),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles])
        else { return }

        recordings = files
            .filter { ["mov", "mp4"].contains($0.pathExtension.lowercased()) }
            .map { url in
                let created = (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                return Recording(url: url, createdAt: created)
            }
            .sorted { $0.createdAt > $1.createdAt }

        if let url { selection = url }
        if selection == nil || !recordings.contains(where: { $0.id == selection }) {
            selection = recordings.first?.id
        }
    }

    func moveToTrash(_ recording: Recording) {
        try? FileManager.default.trashItem(at: recording.url, resultingItemURL: nil)
        reload()
    }
}
