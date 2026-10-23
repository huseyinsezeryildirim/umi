import AVFoundation
import Observation

struct Recording: Identifiable, Hashable {
    /// The `.umi` project folder.
    let url: URL
    let project: RecordingProject
    var id: URL { url }
    var createdAt: Date { project.createdAt }
    var title: String { url.deletingPathExtension().lastPathComponent }
    var screenURL: URL { url.appendingPathComponent(RecordingProject.screenFile) }
    var cameraURL: URL? { project.camera == nil ? nil : url.appendingPathComponent(RecordingProject.cameraFile) }
    var cursorURL: URL { url.appendingPathComponent(RecordingProject.cursorFile) }
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
        return try folderURL().appendingPathComponent("Umi \(formatter.string(from: Date()))").appendingPathExtension("umi")
    }

    func reload(selecting url: URL? = nil) {
        guard let folder = try? Self.folderURL(),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        else { return }

        recordings = files
            .filter { $0.pathExtension == "umi" }
            .compactMap { url in
                // Projects without project.json are still recording, or were interrupted.
                guard let project = try? ProjectStore.read(RecordingProject.self, from: url.appendingPathComponent(RecordingProject.fileName)) else { return nil }
                return Recording(url: url, project: project)
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
