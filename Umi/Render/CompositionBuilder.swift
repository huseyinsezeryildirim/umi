import AVFoundation

/// Builds the playable/exportable timeline for a project: the kept clips (each at its own
/// speed, optionally cross-dissolving into the next), the camera and audio tracks, and a
/// music bed. `UmiCompositor` draws each frame through `FrameRenderer`.
nonisolated enum CompositionBuilder {
    struct Placement: Sendable, Hashable {
        var clip: EditSettings.Clip
        var outputStart: Double
        var outputDuration: Double { clip.outputDuration }
        var outputEnd: Double { outputStart + outputDuration }
    }

    struct Result: @unchecked Sendable {
        let composition: AVComposition
        let videoComposition: AVVideoComposition
        let audioMix: AVAudioMix
        let placements: [Placement]
        var duration: Double { placements.last?.outputEnd ?? 0 }
    }

    private static func time(_ seconds: Double) -> CMTime { CMTime(seconds: seconds, preferredTimescale: 60000) }

    static func build(bundle: URL, renderer: FrameRenderer, renderSize: CGSize) async throws -> Result {
        let project = renderer.project
        let settings = renderer.settings
        let screenAsset = AVURLAsset(url: bundle.appendingPathComponent(RecordingProject.screenFile))
        let cameraAsset = project.camera == nil ? nil : AVURLAsset(url: bundle.appendingPathComponent(RecordingProject.cameraFile))

        let screenDuration = try await screenAsset.load(.duration).seconds
        let total = min(project.duration > 0 ? project.duration : screenDuration, screenDuration)
        let clips = keptClips(settings.clips, total: total)
        let placements = layout(clips, crossfade: settings.crossfade)
        let crossfade = effectiveCrossfade(clips, settings.crossfade)
        let sets = crossfade > 0 && clips.count > 1 ? 2 : 1

        guard let screenSource = try await screenAsset.loadTracks(withMediaType: .video).first else { throw CocoaError(.fileReadCorruptFile) }
        let cameraSource = try? await cameraAsset?.loadTracks(withMediaType: .video).first
        let audioSources = try await screenAsset.loadTracks(withMediaType: .audio)

        let composition = AVMutableComposition()
        func newTrack(_ type: AVMediaType) -> AVMutableCompositionTrack? {
            composition.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)
        }
        // One set of tracks per alternating clip so dissolves can overlap.
        var screenTracks: [AVMutableCompositionTrack] = [], cameraTracks: [AVMutableCompositionTrack?] = [], audioTracks: [[AVMutableCompositionTrack]] = []
        for _ in 0..<sets {
            guard let s = newTrack(.video) else { throw CocoaError(.featureUnsupported) }
            screenTracks.append(s)
            cameraTracks.append(cameraSource == nil ? nil : newTrack(.video))
            audioTracks.append(audioSources.compactMap { _ in newTrack(.audio) })
        }

        for (i, placement) in placements.enumerated() {
            let set = i % sets
            var pairs: [(AVAssetTrack, AVMutableCompositionTrack)] = [(screenSource, screenTracks[set])]
            if let cameraSource, let cameraTrack = cameraTracks[set] { pairs.append((cameraSource, cameraTrack)) }
            pairs += zip(audioSources, audioTracks[set]).map { ($0, $1) }

            for (source, out) in pairs {
                var available = try await source.load(.timeRange)
                // Skip a leading empty edit: the track's range can start at 0 while its first
                // sample comes a few ms later.
                if let first = try? await source.load(.segments).first(where: { !$0.isEmpty })?.timeMapping.target.start,
                   first > available.start, first < available.end {
                    available = CMTimeRange(start: first, end: available.end)
                }
                let range = CMTimeRange(start: time(placement.clip.start), end: time(placement.clip.end)).intersection(available)
                guard !range.isEmpty else { continue }
                // Tracks often start a few ms after 0. Close that gap so the clip's first
                // output frame has a source frame (otherwise it renders background only).
                var lead = (range.start.seconds - placement.clip.start) / placement.clip.speed
                if lead < 0.1 { lead = 0 }
                let at = time(placement.outputStart + lead)
                try out.insertTimeRange(range, of: source, at: at)
                if placement.clip.speed != 1 {
                    out.scaleTimeRange(CMTimeRange(start: at, duration: range.duration),
                                       toDuration: time(range.duration.seconds / placement.clip.speed))
                }
            }
        }

        // Music bed, looped to the length of the edit.
        var musicTrack: AVMutableCompositionTrack?
        let outputDuration = placements.last?.outputEnd ?? 0
        if let music = settings.music {
            let asset = AVURLAsset(url: bundle.appendingPathComponent(music.file))
            if let source = try? await asset.loadTracks(withMediaType: .audio).first, let track = newTrack(.audio) {
                let length = try await asset.load(.duration).seconds
                var cursor = 0.0
                while length > 0.1, cursor < outputDuration {
                    let piece = min(length, outputDuration - cursor)
                    try track.insertTimeRange(CMTimeRange(start: .zero, duration: time(piece)), of: source, at: time(cursor))
                    cursor += piece
                }
                musicTrack = track
            }
        }

        // Media track videos, each on its own track at its output time.
        var overlayTracks: [UUID: CMPersistentTrackID] = [:]
        for overlay in settings.overlays where overlay.kind == .video {
            let asset = AVURLAsset(url: bundle.appendingPathComponent(overlay.file))
            guard let source = try? await asset.loadTracks(withMediaType: .video).first, let track = newTrack(.video) else { continue }
            let available = try await source.load(.timeRange)
            let range = CMTimeRange(start: time(overlay.mediaOffset), duration: time(overlay.end - overlay.start)).intersection(available)
            guard !range.isEmpty else { continue }
            try track.insertTimeRange(range, of: source, at: time(overlay.start))
            overlayTracks[overlay.id] = track.trackID
        }

        // Video instructions: single clips, and two-clip dissolves where they overlap.
        var instructions: [UmiInstruction] = []
        func layer(_ i: Int) -> UmiInstruction.Layer {
            let set = i % sets
            return .init(screenTrackID: screenTracks[set].trackID, cameraTrackID: cameraTracks[set]?.trackID,
                         sourceStart: placements[i].clip.start, outputStart: placements[i].outputStart, speed: placements[i].clip.speed)
        }
        var cursor = 0.0
        for i in placements.indices {
            let soloEnd = i + 1 < placements.count ? placements[i + 1].outputStart : placements[i].outputEnd
            if soloEnd - cursor > 0.0001 {
                instructions.append(UmiInstruction(timeRange: CMTimeRange(start: time(cursor), end: time(soloEnd)), layers: [layer(i)],
                                                   overlayTracks: overlayTracks, renderer: renderer))
                cursor = soloEnd
            }
            if i + 1 < placements.count, crossfade > 0 {
                let end = placements[i].outputEnd
                instructions.append(UmiInstruction(timeRange: CMTimeRange(start: time(cursor), end: time(end)), layers: [layer(i), layer(i + 1)],
                                                   overlayTracks: overlayTracks, renderer: renderer))
                cursor = end
            }
        }

        let videoComposition = AVMutableVideoComposition()
        videoComposition.customVideoCompositorClass = UmiCompositor.self
        videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(project.screen.fps))
        videoComposition.renderSize = renderSize
        videoComposition.instructions = instructions

        // Audio: dissolves crossfade the sound too; music sits under it and fades out.
        let mix = AVMutableAudioMix()
        var parameters: [AVMutableAudioMixInputParameters] = []
        for set in 0..<sets {
            for track in audioTracks[set] {
                let p = AVMutableAudioMixInputParameters(track: track)
                p.setVolume(1, at: .zero)
                if crossfade > 0 {
                    for i in placements.indices where i % sets == set {
                        if i > 0 {
                            p.setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: CMTimeRange(start: time(placements[i].outputStart), duration: time(crossfade)))
                        }
                        if i + 1 < placements.count {
                            p.setVolumeRamp(fromStartVolume: 1, toEndVolume: 0, timeRange: CMTimeRange(start: time(placements[i + 1].outputStart), duration: time(crossfade)))
                        }
                    }
                }
                parameters.append(p)
            }
        }
        if let musicTrack, let music = settings.music {
            let p = AVMutableAudioMixInputParameters(track: musicTrack)
            p.setVolume(Float(music.volume), at: .zero)
            let fade = min(music.fadeOut, outputDuration)
            if fade > 0 {
                p.setVolumeRamp(fromStartVolume: Float(music.volume), toEndVolume: 0, timeRange: CMTimeRange(start: time(outputDuration - fade), duration: time(fade)))
            }
            parameters.append(p)
        }
        mix.inputParameters = parameters

        return Result(composition: composition, videoComposition: videoComposition, audioMix: mix, placements: placements)
    }

    /// Clips clamped to the recording; empty means the whole recording.
    static func keptClips(_ clips: [EditSettings.Clip], total: Double) -> [EditSettings.Clip] {
        let valid = clips
            .map { EditSettings.Clip(start: max(0, $0.start), end: min(total, $0.end), speed: min(max($0.speed, 0.25), 8)) }
            .filter { $0.duration > 0.05 }
        return valid.isEmpty ? [EditSettings.Clip(start: 0, end: total)] : valid
    }

    /// The dissolve can't be longer than half of either neighbouring clip.
    static func effectiveCrossfade(_ clips: [EditSettings.Clip], _ crossfade: Double) -> Double {
        guard clips.count > 1, crossfade > 0 else { return 0 }
        return min(crossfade, clips.map(\.outputDuration).min()! / 2)
    }

    /// Where each clip starts on the output timeline (overlapping by the crossfade).
    static func layout(_ clips: [EditSettings.Clip], crossfade: Double) -> [Placement] {
        let fade = effectiveCrossfade(clips, crossfade)
        var cursor = 0.0
        return clips.map { clip in
            defer { cursor += clip.outputDuration - fade }
            return Placement(clip: clip, outputStart: cursor)
        }
    }

    /// Output size for a target resolution: the chosen aspect ratio, or the (cropped)
    /// recording's own shape. `maxHeight` is the short side for vertical/portrait videos.
    static func renderSize(for project: RecordingProject, maxHeight: Int) -> CGSize {
        let edit = project.edit ?? EditSettings()
        let crop = edit.crop ?? CGRect(x: 0, y: 0, width: 1, height: 1)
        let w = Double(project.screen.pixelWidth) * crop.width, h = Double(project.screen.pixelHeight) * crop.height
        let ratio = edit.aspect.ratio ?? w / max(h, 1)
        let short = min(Double(maxHeight), max(min(w, h), 360))
        let size = ratio >= 1 ? CGSize(width: short * ratio, height: short) : CGSize(width: short, height: short / ratio)
        return CGSize(width: Int(size.width) & ~1, height: Int(size.height) & ~1)
    }
}

nonisolated final class UmiInstruction: NSObject, AVVideoCompositionInstructionProtocol, @unchecked Sendable {
    struct Layer: Sendable {
        var screenTrackID: CMPersistentTrackID
        var cameraTrackID: CMPersistentTrackID?
        var sourceStart: Double
        var outputStart: Double
        var speed: Double

        /// Recording time shown at output time `t`.
        func sourceTime(_ t: Double) -> Double { sourceStart + (t - outputStart) * speed }
    }

    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID = kCMPersistentTrackID_Invalid
    let layers: [Layer]
    /// Media track videos by overlay id.
    let overlayTracks: [UUID: CMPersistentTrackID]
    let renderer: FrameRenderer

    init(timeRange: CMTimeRange, layers: [Layer], overlayTracks: [UUID: CMPersistentTrackID] = [:], renderer: FrameRenderer) {
        self.timeRange = timeRange
        self.layers = layers
        self.overlayTracks = overlayTracks
        self.renderer = renderer
        let ids = layers.flatMap { [$0.screenTrackID] + ($0.cameraTrackID.map { [$0] } ?? []) } + overlayTracks.values
        requiredSourceTrackIDs = ids.map { NSNumber(value: $0) }
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
              let output = request.renderContext.newPixelBuffer(),
              let first = instruction.layers.first
        else {
            request.finish(with: CocoaError(.featureUnsupported))
            return
        }
        let t = request.compositionTime.seconds
        var overlays: [UUID: CVPixelBuffer] = [:]
        for (id, track) in instruction.overlayTracks {
            if let frame = request.sourceFrame(byTrackID: track) { overlays[id] = frame }
        }
        func frames(_ layer: UmiInstruction.Layer) -> (CVPixelBuffer?, CVPixelBuffer?, Double) {
            (request.sourceFrame(byTrackID: layer.screenTrackID), layer.cameraTrackID.flatMap { request.sourceFrame(byTrackID: $0) }, layer.sourceTime(t))
        }
        if instruction.layers.count == 2 {
            let range = instruction.timeRange
            let progress = (t - range.start.seconds) / max(range.duration.seconds, 0.001)
            let a = frames(first), b = frames(instruction.layers[1])
            instruction.renderer.renderDissolve(from: (a.0, a.1, a.2), to: (b.0, b.1, b.2), progress: min(max(progress, 0), 1),
                                                outputTime: t, overlays: overlays, into: output)
        } else {
            let a = frames(first)
            instruction.renderer.render(screen: a.0, camera: a.1, at: a.2, outputTime: t, overlays: overlays, into: output)
        }
        request.finish(withComposedVideoFrame: output)
    }

    func cancelAllPendingVideoCompositionRequests() {}
}
