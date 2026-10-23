import AVFoundation

/// Renders a project to a shareable MP4 (H.264 + AAC, audio tracks mixed to one).
nonisolated enum Exporter {
    enum Resolution: Int, CaseIterable, Identifiable, Sendable {
        case p720 = 720, p1080 = 1080, p1440 = 1440, p2160 = 2160
        var id: Int { rawValue }
        var label: String { self == .p2160 ? "4K" : "\(rawValue)p" }
    }

    static func export(bundle: URL, renderer: FrameRenderer, resolution: Resolution, fps: Int, to destination: URL,
                       progress: (@Sendable (Double) -> Void)? = nil) async throws {
        let size = CompositionBuilder.renderSize(for: renderer.project, maxHeight: resolution.rawValue)
        let built = try await CompositionBuilder.build(bundle: bundle, renderer: renderer, renderSize: size)
        let videoComposition = built.videoComposition.mutableCopy() as! AVMutableVideoComposition
        videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))

        guard let session = AVAssetExportSession(asset: built.composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw CocoaError(.featureUnsupported)
        }
        session.videoComposition = videoComposition
        session.audioMix = built.audioMix
        session.shouldOptimizeForNetworkUse = true
        try? FileManager.default.removeItem(at: destination)

        nonisolated(unsafe) let observed = session
        let monitor = Task {
            for await state in observed.states(updateInterval: 0.2) {
                if case .exporting(let p) = state { progress?(p.fractionCompleted) }
            }
        }
        defer { monitor.cancel() }
        try await session.export(to: destination, as: .mp4)
        progress?(1)
    }
}
