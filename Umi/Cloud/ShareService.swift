import AVFoundation
import AppKit
import ImageIO
import Observation
import UniformTypeIdentifiers

/// Uploads one recording to Umi Cloud: export → create link (copied at once) → upload parts,
/// poster and GIF preview → complete. The link is remembered in the project bundle.
@Observable
final class ShareService {
    enum Phase: Equatable {
        case idle
        case exporting(Double)
        case uploading(Double)
        case ready
        case failed(String)
    }

    let bundle: URL
    private(set) var phase: Phase = .idle
    private(set) var video: CloudVideo?
    /// Needs an Umi Cloud plan (the server said 402).
    private(set) var needsPlan = false
    private var task: Task<Void, Never>?

    private static var services: [URL: ShareService] = [:]

    /// One service per recording, so reopening the share window shows the running upload.
    static func `for`(_ bundle: URL) -> ShareService {
        if let existing = services[bundle] { return existing }
        let service = ShareService(bundle: bundle)
        services[bundle] = service
        return service
    }

    private init(bundle: URL) {
        self.bundle = bundle
        if let data = try? Data(contentsOf: recordURL), let saved = try? JSONDecoder().decode(CloudVideo.self, from: data) {
            video = saved
            phase = .ready
        }
    }

    private var recordURL: URL { bundle.appendingPathComponent("share.json") }

    var isBusy: Bool {
        switch phase {
        case .exporting, .uploading: true
        default: false
        }
    }

    /// Starts (or restarts) the upload. The link is put on the clipboard as soon as it exists.
    /// - Parameter exported: an MP4 already made from this recording (Instant mode), so it
    ///   isn't exported twice.
    func share(copyLink: Bool = true, exported: URL? = nil) {
        guard !isBusy else { return }
        needsPlan = false
        task = Task { await run(copyLink: copyLink, exported: exported) }
    }

    func cancel() {
        task?.cancel()
        task = nil
        if case .ready = phase {} else { phase = video == nil ? .idle : .ready }
    }

    func copyLink(at seconds: Double? = nil) {
        guard let link = link(at: seconds) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link.absoluteString, forType: .string)
    }

    func link(at seconds: Double? = nil) -> URL? {
        guard let url = video?.url else { return nil }
        guard let seconds, seconds >= 1 else { return url }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "t", value: "\(Int(seconds))")]
        return components?.url ?? url
    }

    func update(_ settings: CloudClient.Settings) async throws {
        guard let id = video?.id else { return }
        let updated = try await CloudClient().update(id: id, settings)
        store(updated)
    }

    func deleteLink() async throws {
        guard let id = video?.id else { return }
        try await CloudClient().delete(id: id)
        video = nil
        phase = .idle
        try? FileManager.default.removeItem(at: recordURL)
    }

    // MARK: Upload

    private func run(copyLink: Bool, exported: URL?) async {
        do {
            phase = .exporting(0)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("UmiShare-\(UUID().uuidString)", isDirectory: true)
            defer { try? FileManager.default.removeItem(at: folder) }
            let mp4: URL
            if let exported {
                mp4 = exported
            } else {
                mp4 = try await InstantShareController.exportPolished(bundle, to: folder) { value in
                    Task { @MainActor in if case .exporting = self.phase { self.phase = .exporting(value) } }
                }
            }
            try Task.checkCancellation()

            let asset = AVURLAsset(url: mp4)
            let duration = try await asset.load(.duration).seconds
            let size = try await asset.loadTracks(withMediaType: .video).first?.load(.naturalSize) ?? .zero
            let bytes = (try FileManager.default.attributesOfItem(atPath: mp4.path)[.size] as? Int) ?? 0
            let title = bundle.deletingPathExtension().lastPathComponent

            phase = .uploading(0)
            let client = CloudClient()
            let created = try await client.create(title: title, sizeBytes: bytes, durationMs: Int(duration * 1000),
                                                  width: Int(size.width), height: Int(size.height))
            store(created.video)
            if copyLink { self.copyLink() }

            // Poster and preview first (small), then the video parts, three at a time.
            if let url = created.upload.thumbnailUrl, let jpeg = await Self.poster(asset) {
                _ = try await CloudClient.put(jpeg, to: url, contentType: "image/jpeg")
            }
            if let url = created.upload.gifUrl, let gif = await Self.gifPreview(asset) {
                _ = try await CloudClient.put(gif, to: url, contentType: "image/gif")
            }
            let etags = try await uploadParts(of: mp4, plan: created.upload, total: bytes)
            let done = try await client.complete(id: created.video.id, etags: etags)
            store(done)
            phase = .ready
        } catch is CancellationError {
            phase = video == nil ? .idle : .ready
        } catch let error as CloudError {
            needsPlan = error.needsPlan
            phase = .failed(error.message)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func uploadParts(of file: URL, plan: CloudClient.UploadPlan, total: Int) async throws -> [Int: String] {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var etags: [Int: String] = [:]
        var sent = 0
        var pending = plan.parts[...]
        try await withThrowingTaskGroup(of: (Int, String, Int).self) { group in
            func next() throws {
                guard let part = pending.popFirst() else { return }
                try handle.seek(toOffset: UInt64((part.partNumber - 1) * plan.partSize))
                let data = handle.readData(ofLength: plan.partSize)
                group.addTask {
                    // One retry per part: flaky Wi-Fi shouldn't fail the whole upload.
                    let etag: String
                    do { etag = try await CloudClient.put(data, to: part.url, contentType: "application/octet-stream") } catch {
                        etag = try await CloudClient.put(data, to: part.url, contentType: "application/octet-stream")
                    }
                    return (part.partNumber, etag, data.count)
                }
            }
            for _ in 0..<3 { try next() }
            while let (number, etag, count) = try await group.next() {
                etags[number] = etag
                sent += count
                phase = .uploading(Double(sent) / Double(max(total, 1)))
                try next()
            }
        }
        return etags
    }

    private func store(_ video: CloudVideo) {
        self.video = video
        if let data = try? JSONEncoder().encode(video) { try? data.write(to: recordURL) }
    }

    // MARK: Poster and GIF

    /// A 1280-wide JPEG from one second in.
    nonisolated static func poster(_ asset: AVURLAsset) async -> Data? {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.maximumSize = CGSize(width: 1280, height: 1280)
        generator.appliesPreferredTrackTransform = true
        guard let (image, _) = try? await generator.image(at: CMTime(seconds: 1, preferredTimescale: 600)) else { return nil }
        return NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.82])
    }

    /// A short looping GIF (first 4 s, 10 fps, 480 wide) for emails and docs, like Loom's.
    nonisolated static func gifPreview(_ asset: AVURLAsset) async -> Data? {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.maximumSize = CGSize(width: 480, height: 480)
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 20)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 20)
        let duration = (try? await asset.load(.duration).seconds) ?? 0
        let fps = 10.0
        let count = max(Int(min(duration, 4) * fps), 1)
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.gif.identifier as CFString, count, nil) else { return nil }
        CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
        let frameProperties = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1 / fps]] as CFDictionary
        for i in 0..<count {
            let time = CMTime(seconds: 0.2 + Double(i) / fps, preferredTimescale: 600)
            if let (image, _) = try? await generator.image(at: time) {
                CGImageDestinationAddImage(destination, image, frameProperties)
            }
        }
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }
}
