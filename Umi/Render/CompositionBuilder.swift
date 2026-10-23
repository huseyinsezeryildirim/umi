import AVFoundation

/// Builds the playable/exportable timeline for a project: the kept clips of every track
/// laid end to end, with `UmiCompositor` drawing each frame through `FrameRenderer`.
nonisolated enum CompositionBuilder {
    struct Result: @unchecked Sendable {
        let composition: AVComposition
        let videoComposition: AVVideoComposition
        /// Kept clips with their start on the output timeline.
        let clips: [(source: TimeRangeValue, outputStart: Double)]
        var duration: Double { clips.last.map { $0.outputStart + $0.source.duration } ?? 0 }
    }

    static func build(bundle: URL, renderer: FrameRenderer, renderSize: CGSize) async throws -> Result {
        let project = renderer.project
        let screenAsset = AVURLAsset(url: bundle.appendingPathComponent(RecordingProject.screenFile))
        let cameraAsset = project.camera == nil ? nil : AVURLAsset(url: bundle.appendingPathComponent(RecordingProject.cameraFile))

        let composition = AVMutableComposition()
        let screenDuration = try await screenAsset.load(.duration).seconds
        let total = min(project.duration > 0 ? project.duration : screenDuration, screenDuration)
        let clips = keptClips(renderer.settings.clips, total: total)

        var sources: [(AVAssetTrack, AVMutableCompositionTrack)] = []
        let screenTrackID: CMPersistentTrackID
        var cameraTrackID: CMPersistentTrackID?

        guard let screenVideo = try await screenAsset.loadTracks(withMediaType: .video).first,
              let screenOut = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw CocoaError(.fileReadCorruptFile) }
        sources.append((screenVideo, screenOut))
        screenTrackID = screenOut.trackID

        if let cameraAsset, let cameraVideo = try? await cameraAsset.loadTracks(withMediaType: .video).first,
           let cameraOut = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) {
            sources.append((cameraVideo, cameraOut))
            cameraTrackID = cameraOut.trackID
        }

        for audio in try await screenAsset.loadTracks(withMediaType: .audio) {
            if let out = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                sources.append((audio, out))
            }
        }

        var cursor = 0.0
        var placed: [(source: TimeRangeValue, outputStart: Double)] = []
        for clip in clips {
            for (source, out) in sources {
                let available = try await source.load(.timeRange)
                let range = CMTimeRange(start: CMTime(seconds: clip.start, preferredTimescale: 6000),
                                        end: CMTime(seconds: clip.end, preferredTimescale: 6000))
                    .intersection(available)
                guard !range.isEmpty else { continue }
                let at = CMTime(seconds: cursor + (range.start.seconds - clip.start), preferredTimescale: 6000)
                try out.insertTimeRange(range, of: source, at: at)
            }
            placed.append((clip, cursor))
            cursor += clip.duration
        }

        let instructions = placed.map { clip in
            UmiInstruction(
                timeRange: CMTimeRange(start: CMTime(seconds: clip.outputStart, preferredTimescale: 6000),
                                       duration: CMTime(seconds: clip.source.duration, preferredTimescale: 6000)),
                sourceOffset: clip.source.start - clip.outputStart,
                screenTrackID: screenTrackID,
                cameraTrackID: cameraTrackID,
                renderer: renderer
            )
        }

        let videoComposition = AVMutableVideoComposition()
        videoComposition.customVideoCompositorClass = UmiCompositor.self
        videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(project.screen.fps))
        videoComposition.renderSize = renderSize
        videoComposition.instructions = instructions

        return Result(composition: composition, videoComposition: videoComposition, clips: placed)
    }

    static func keptClips(_ clips: [TimeRangeValue], total: Double) -> [TimeRangeValue] {
        let valid = clips
            .map { TimeRangeValue(start: max(0, $0.start), end: min(total, $0.end)) }
            .filter { $0.duration > 0.05 }
        return valid.isEmpty ? [TimeRangeValue(start: 0, end: total)] : valid
    }

    /// Output size for a target height, matching the screen's aspect ratio (even dimensions).
    static func renderSize(for project: RecordingProject, maxHeight: Int) -> CGSize {
        let w = Double(project.screen.pixelWidth), h = Double(project.screen.pixelHeight)
        let height = min(Double(maxHeight), h)
        let width = height * w / max(h, 1)
        return CGSize(width: Int(width) & ~1, height: Int(height) & ~1)
    }
}

nonisolated final class UmiInstruction: NSObject, AVVideoCompositionInstructionProtocol, @unchecked Sendable {
    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID = kCMPersistentTrackID_Invalid

    /// Source (recording) time = output time + offset.
    let sourceOffset: Double
    let screenTrackID: CMPersistentTrackID
    let cameraTrackID: CMPersistentTrackID?
    let renderer: FrameRenderer

    init(timeRange: CMTimeRange, sourceOffset: Double, screenTrackID: CMPersistentTrackID, cameraTrackID: CMPersistentTrackID?, renderer: FrameRenderer) {
        self.timeRange = timeRange
        self.sourceOffset = sourceOffset
        self.screenTrackID = screenTrackID
        self.cameraTrackID = cameraTrackID
        self.renderer = renderer
        requiredSourceTrackIDs = ([screenTrackID] + (cameraTrackID.map { [$0] } ?? [])).map { NSNumber(value: $0) }
    }
}

nonisolated final class UmiCompositor: NSObject, AVVideoCompositing, @unchecked Sendable {
    private static let bgra: [String: any Sendable] = [
        kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA],
        kCVPixelBufferMetalCompatibilityKey as String: true,
    ]

    var sourcePixelBufferAttributes: [String: any Sendable]? { Self.bgra }
    var requiredPixelBufferAttributesForRenderContext: [String: any Sendable] { Self.bgra }
    var supportsWideColorSourceFrames: Bool { false }

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        guard let instruction = request.videoCompositionInstruction as? UmiInstruction,
              let output = request.renderContext.newPixelBuffer()
        else {
            request.finish(with: CocoaError(.featureUnsupported))
            return
        }
        let screen = request.sourceFrame(byTrackID: instruction.screenTrackID)
        let camera = instruction.cameraTrackID.flatMap { request.sourceFrame(byTrackID: $0) }
        let time = request.compositionTime.seconds + instruction.sourceOffset
        instruction.renderer.render(screen: screen, camera: camera, at: time, into: output)
        request.finish(withComposedVideoFrame: output)
    }

    func cancelAllPendingVideoCompositionRequests() {}
}
