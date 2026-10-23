import AVFoundation

/// Joins the segment files produced by pause/resume into one movie.
enum SegmentMerger {
    static func merge(_ segments: [URL], into destination: URL) async throws {
        try? FileManager.default.removeItem(at: destination)

        if segments.count == 1, let only = segments.first {
            try FileManager.default.moveItem(at: only, to: destination)
            return
        }

        let composition = AVMutableComposition()
        // One composition track per source track position, so mic and system audio stay separate.
        var compositionTracks: [AVMediaType: [AVMutableCompositionTrack]] = [:]
        var cursor = CMTime.zero

        for url in segments {
            let asset = AVURLAsset(url: url)
            let duration = try await asset.load(.duration)
            let range = CMTimeRange(start: .zero, duration: duration)

            for mediaType in [AVMediaType.video, .audio] {
                let sourceTracks = try await asset.loadTracks(withMediaType: mediaType)
                for (index, sourceTrack) in sourceTracks.enumerated() {
                    var tracks = compositionTracks[mediaType, default: []]
                    if index >= tracks.count,
                       let track = composition.addMutableTrack(withMediaType: mediaType, preferredTrackID: kCMPersistentTrackID_Invalid) {
                        tracks.append(track)
                        compositionTracks[mediaType] = tracks
                    }
                    try tracks[index].insertTimeRange(range, of: sourceTrack, at: cursor)
                }
            }
            cursor = cursor + duration
        }

        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
            throw CocoaError(.fileWriteUnknown)
        }
        try await export.export(to: destination, as: .mov)

        for url in segments {
            try? FileManager.default.removeItem(at: url)
        }
    }
}
