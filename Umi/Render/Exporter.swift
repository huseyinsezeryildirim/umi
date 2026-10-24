import AVFoundation
import ImageIO
import UniformTypeIdentifiers

/// Renders a project to a shareable file: MP4 or MOV (H.264 + AAC, audio tracks mixed to
/// one), or an animated GIF.
nonisolated enum Exporter {
    enum Format: String, CaseIterable, Identifiable, Sendable {
        case mp4, mov, gif
        var id: String { rawValue }
        var label: String { self == .gif ? "GIF" : rawValue.uppercased() }
        var fileExtension: String { rawValue }
    }

    enum Resolution: Int, CaseIterable, Identifiable, Sendable {
        case p720 = 720, p1080 = 1080, p1440 = 1440, p2160 = 2160
        var id: Int { rawValue }
        var label: String { self == .p2160 ? "4K" : "\(rawValue)p" }
    }

    static func export(bundle: URL, renderer: FrameRenderer, resolution: Resolution, fps: Int, format: Format = .mp4, to destination: URL,
                       progress: (@Sendable (Double) -> Void)? = nil) async throws {
        if format == .gif {
            try await exportGIF(bundle: bundle, renderer: renderer, maxHeight: min(resolution.rawValue, 540), to: destination, progress: progress)
            return
        }
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
        try await session.export(to: destination, as: format == .mov ? .mov : .mp4)
        progress?(1)
    }

    /// An animated GIF at 15 fps, looping forever.
    static func exportGIF(bundle: URL, renderer: FrameRenderer, maxHeight: Int, to destination: URL,
                          progress: (@Sendable (Double) -> Void)? = nil) async throws {
        let size = CompositionBuilder.renderSize(for: renderer.project, maxHeight: maxHeight)
        let built = try await CompositionBuilder.build(bundle: bundle, renderer: renderer, renderSize: size)
        let fps = 15.0
        let count = max(Int(built.duration * fps), 1)
        try? FileManager.default.removeItem(at: destination)
        guard let gif = CGImageDestinationCreateWithURL(destination as CFURL, UTType.gif.identifier as CFString, count, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        CGImageDestinationSetProperties(gif, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
        let generator = AVAssetImageGenerator(asset: built.composition)
        generator.videoComposition = built.videoComposition
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 60)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 60)
        let frameProperties = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1 / fps]] as CFDictionary
        for i in 0..<count {
            let (image, _) = try await generator.image(at: CMTime(seconds: Double(i) / fps, preferredTimescale: 600))
            CGImageDestinationAddImage(gif, image, frameProperties)
            progress?(Double(i + 1) / Double(count))
        }
        guard CGImageDestinationFinalize(gif) else { throw CocoaError(.fileWriteUnknown) }
    }
}
