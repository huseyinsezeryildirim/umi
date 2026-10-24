import AppKit
import AVFoundation
import Observation
import UniformTypeIdentifiers

/// What's selected in the editor; drives the timeline highlight, the inspector and the
/// preview overlay handles.
enum EditorSelection: Hashable {
    case clip(Int)
    case zoom(UUID)
    case mask(UUID)
    case scene(UUID)
    case text(UUID)
    case move(UUID)
    case music
    case overlay(UUID)
}

/// State of one open editor window: the project, its edits, the preview player and export.
@Observable
final class EditorModel {
    let bundle: URL
    private(set) var project: RecordingProject
    private(set) var edit: EditSettings
    private(set) var loadError: String?

    let player = AVPlayer()
    private(set) var currentTime: Double = 0
    private(set) var isPlaying = false
    /// Clips laid out on the output timeline (after cuts, speed and crossfades).
    private(set) var placements: [CompositionBuilder.Placement] = []
    /// Generated (from clicks) and manual zooms, computed from the edit right away so the
    /// timeline follows a drag live instead of waiting for the preview to rebuild.
    var zoomSegments: [EditSettings.ZoomSegment] {
        zoomSegments(in: edit)
    }

    /// Zooms for a given edit. Takes the edit as a value so code that is mutating `edit`
    /// (inside `update`) can call it without overlapping access to `self.edit`.
    private func zoomSegments(in edit: EditSettings) -> [EditSettings.ZoomSegment] {
        let generated = edit.zoom.auto ? ZoomTrack.autoSegments(from: cursorData.clicks, scale: edit.zoom.scale, duration: project.duration) : []
        return (edit.zoom.segments + generated).sorted { $0.start < $1.start }
    }
    var outputDuration: Double { placements.last?.outputEnd ?? 0 }
    /// A span of the output timeline selected on the ruler, for Cut.
    var rangeSelection: ClosedRange<Double>?
    var selection: EditorSelection? {
        didSet { refreshPreviewMode() }
    }

    private(set) var exportProgress: Double?
    private(set) var lastExportURL: URL?
    private(set) var captionProgress: String?

    var undoManager: UndoManager?
    /// The renderer behind the current preview, for mapping overlay handles.
    private(set) var renderer: FrameRenderer?
    /// Preview resolution: 1 = up to 1080p, 0.5 = half (smoother on big recordings).
    var previewQuality = 1.0 {
        didSet { rebuild(keepTime: true) }
    }
    /// Size of the preview canvas: the export's shape at preview resolution.
    var previewSize: CGSize {
        var project = project
        project.edit = edit
        return CompositionBuilder.renderSize(for: project, maxHeight: Int(1080 * previewQuality))
    }

    private var cursorData = CursorData()
    private let cursorImage = FrameRenderer.CursorImage.arrow
    private var rebuildTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    private var timeObserver: Any?
    private var gestureSnapshot: EditSettings?

    init(bundle: URL) {
        self.bundle = bundle
        let project = (try? ProjectStore.read(RecordingProject.self, from: bundle.appendingPathComponent(RecordingProject.fileName)))
            ?? RecordingProject(createdAt: .now, duration: 0, screen: .init(pixelWidth: 1920, pixelHeight: 1080, captureRect: .zero, fps: 60), audio: .init())
        self.project = project
        edit = project.edit ?? project.defaultEdit
        cursorData = (try? ProjectStore.read(CursorData.self, from: bundle.appendingPathComponent(RecordingProject.cursorFile))) ?? CursorData()

        let interval = CMTime(value: 1, timescale: 30)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.currentTime = time.seconds
                self.isPlaying = self.player.rate != 0
            }
        }
        rebuild(keepTime: false)
        let screen = bundle.appendingPathComponent(RecordingProject.screenFile), mic = project.audio.microphoneTrack
        Task { waveform = await Waveform.load(screen, preferredTrack: mic) }
    }

    // MARK: Open models

    private static var openModels: [URL: EditorModel] = [:]

    /// The model for a recording's editor window, created once.
    static func open(_ bundle: URL) -> EditorModel {
        if let model = openModels[bundle] { return model }
        let model = EditorModel(bundle: bundle)
        openModels[bundle] = model
        return model
    }

    /// Called when the editor window closes, so reopening starts fresh.
    static func close(_ bundle: URL) {
        openModels[bundle]?.player.pause()
        openModels[bundle] = nil
    }

    // MARK: Editing

    /// Applies a change with undo. During a slider drag, wrap calls in begin/endGesture
    /// so the whole drag is one undo step.
    func update(_ change: (inout EditSettings) -> Void) {
        let before = edit
        change(&edit)
        guard edit != before else { return }
        if gestureSnapshot == nil { registerUndo(from: before) }
        changed()
    }

    func beginGesture() { gestureSnapshot = edit }

    func endGesture() {
        if let snapshot = gestureSnapshot, snapshot != edit { registerUndo(from: snapshot) }
        gestureSnapshot = nil
    }

    private func registerUndo(from previous: EditSettings) {
        let current = edit
        undoManager?.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated {
                model.edit = previous
                model.registerUndo(from: current)
                model.changed()
            }
        }
    }

    private func changed() {
        rebuild(keepTime: true)
        scheduleSave()
    }

    // MARK: Clips

    private var keptClips: [EditSettings.Clip] { placements.map(\.clip) }

    func split(at outputTime: Double) {
        guard let index = clipIndex(at: outputTime), let cut = sourceTime(for: outputTime) else { return }
        let clip = keptClips[index]
        guard cut - clip.start > 0.1, clip.end - cut > 0.1 else { return }
        update { edit in
            var kept = keptClips
            kept.replaceSubrange(index...index, with: [
                EditSettings.Clip(start: clip.start, end: cut, speed: clip.speed),
                EditSettings.Clip(start: cut, end: clip.end, speed: clip.speed),
            ])
            edit.clips = kept
        }
    }

    func deleteClip(at index: Int) {
        guard keptClips.count > 1, keptClips.indices.contains(index) else { return }
        update { edit in
            var kept = keptClips
            kept.remove(at: index)
            edit.clips = kept
        }
        selection = nil
    }

    /// Moves one edge of a clip, in source time.
    func trimClip(at index: Int, start: Double? = nil, end: Double? = nil) {
        guard keptClips.indices.contains(index) else { return }
        update { edit in
            var kept = keptClips
            if let start { kept[index].start = min(max(start, 0), kept[index].end - 0.2) }
            if let end { kept[index].end = max(min(end, project.duration), kept[index].start + 0.2) }
            edit.clips = kept
        }
    }

    func setSpeed(_ speed: Double, forClip index: Int) {
        guard keptClips.indices.contains(index) else { return }
        update { edit in
            var kept = keptClips
            kept[index].speed = speed
            edit.clips = kept
        }
    }

    func moveClip(from: Int, to: Int) {
        guard keptClips.indices.contains(from), keptClips.indices.contains(to), from != to else { return }
        update { edit in
            var kept = keptClips
            kept.insert(kept.remove(at: from), at: to)
            edit.clips = kept
        }
        selection = .clip(to)
    }

    // MARK: Zoom

    func addZoom(at outputTime: Double) {
        guard let source = sourceTime(for: outputTime) else { return }
        // Inside an existing zoom: select it instead of stacking another on top.
        if let existing = zoomSegments.first(where: { source >= $0.start && source <= $0.end }) {
            selection = .zoom(existing.id)
            return
        }
        // Up to 3 s, stopping short of the next zoom.
        let next = zoomSegments.map(\.start).filter { $0 > source }.min() ?? project.duration
        let segment = EditSettings.ZoomSegment(start: source, end: min(source + 3, next - 0.05, project.duration), scale: edit.zoom.scale)
        update { edit in
            materializeAutoZoom(&edit)
            edit.zoom.segments.append(segment)
        }
        selection = .zoom(segment.id)
    }

    func updateZoom(_ id: UUID, _ change: (inout EditSettings.ZoomSegment) -> Void) {
        update { edit in
            materializeAutoZoom(&edit)
            guard let i = edit.zoom.segments.firstIndex(where: { $0.id == id }) else { return }
            var segment = edit.zoom.segments[i]
            change(&segment)
            (segment.start, segment.end) = clamped(segment.start, segment.end)
            edit.zoom.segments[i] = segment
        }
    }

    func deleteZoom(_ id: UUID) {
        update { edit in
            materializeAutoZoom(&edit)
            edit.zoom.segments.removeAll { $0.id == id }
        }
    }

    /// Editing a generated zoom turns all generated zooms into manual ones, so they can
    /// be moved and deleted individually.
    private func materializeAutoZoom(_ edit: inout EditSettings) {
        guard edit.zoom.auto else { return }
        edit.zoom.segments = zoomSegments(in: edit)
        edit.zoom.auto = false
    }

    // MARK: Masks, scenes, text, 3D moves

    func addMask(at outputTime: Double) {
        guard let source = sourceTime(for: outputTime) else { return }
        let mask = EditSettings.PrivacyMask(start: source, end: min(source + 3, project.duration), rect: CGRect(x: 0.35, y: 0.35, width: 0.3, height: 0.2))
        update { $0.masks.append(mask) }
        selection = .mask(mask.id)
        reveal(mask.start)
    }

    func addScene(_ layout: EditSettings.SceneLayout, at outputTime: Double) {
        guard let source = sourceTime(for: outputTime) else { return }
        let scene = EditSettings.SceneSegment(start: source, end: min(source + 4, project.duration), layout: layout)
        update { $0.scenes.append(scene) }
        selection = .scene(scene.id)
        reveal(scene.start + scene.transition)
    }

    func addText(_ style: EditSettings.TextStyle, at outputTime: Double) {
        guard let source = sourceTime(for: outputTime) else { return }
        let (text, detail, position): (String, String, CGPoint) = switch style {
        case .title: ("Your title", "", CGPoint(x: 0.5, y: 0.45))
        case .lowerThird: ("Your Name", "Your role", CGPoint(x: 0.24, y: 0.82))
        case .kicker: ("New", "", CGPoint(x: 0.5, y: 0.14))
        case .bigStat: ("42%", "faster onboarding", CGPoint(x: 0.5, y: 0.45))
        case .quote: ("Simple things should be simple", "Alan Kay", CGPoint(x: 0.5, y: 0.45))
        case .typewriter: ("Type something…", "", CGPoint(x: 0.5, y: 0.2))
        }
        let overlay = EditSettings.TextOverlay(start: source, end: min(source + 4, project.duration), style: style, text: text, detail: detail,
                                               position: position, animation: style == .typewriter ? .typewriter : .slide)
        update { $0.texts.append(overlay) }
        selection = .text(overlay.id)
        reveal(overlay.start + 0.4)
    }

    func addMove(_ kind: EditSettings.MoveKind, at outputTime: Double) {
        guard let source = sourceTime(for: outputTime) else { return }
        let move = EditSettings.CameraMove(start: source, end: min(source + 4, project.duration), kind: kind)
        update { $0.moves.append(move) }
        selection = .move(move.id)
        reveal(move.start + 1)
    }

    /// Moves the playhead to a source time (past an item's fade-in) so a new item shows.
    private func reveal(_ sourceTime: Double) {
        if let t = outputTime(for: min(sourceTime + 0.25, project.duration)) { seek(to: t) }
    }

    func updateMask(_ id: UUID, _ change: (inout EditSettings.PrivacyMask) -> Void) { updateItem(\.masks, id, change) }
    func updateScene(_ id: UUID, _ change: (inout EditSettings.SceneSegment) -> Void) { updateItem(\.scenes, id, change) }
    func updateText(_ id: UUID, _ change: (inout EditSettings.TextOverlay) -> Void) { updateItem(\.texts, id, change) }
    func updateMove(_ id: UUID, _ change: (inout EditSettings.CameraMove) -> Void) { updateItem(\.moves, id, change) }

    /// Moves or resizes any timed item (source time), whatever its kind.
    func retime(_ selection: EditorSelection, start: Double, end: Double) {
        switch selection {
        case .zoom(let id): updateZoom(id) { $0.start = start; $0.end = end }
        case .mask(let id): updateMask(id) { $0.start = start; $0.end = end }
        case .scene(let id): updateScene(id) { $0.start = start; $0.end = end }
        case .text(let id): updateText(id) { $0.start = start; $0.end = end }
        case .move(let id): updateMove(id) { $0.start = start; $0.end = end }
        case .clip, .music: break
        case .overlay(let id): retimeOverlay(id, start: start, end: end)
        }
    }

    func deleteSelection() {
        switch selection {
        case .clip(let i): deleteClip(at: i)
        case .zoom(let id): deleteZoom(id)
        case .mask(let id): update { $0.masks.removeAll { $0.id == id } }
        case .scene(let id): update { $0.scenes.removeAll { $0.id == id } }
        case .text(let id): update { $0.texts.removeAll { $0.id == id } }
        case .move(let id): update { $0.moves.removeAll { $0.id == id } }
        case .music: update { $0.music = nil }
        case .overlay(let id): update { $0.overlays.removeAll { $0.id == id } }
        case nil:
            if let range = rangeSelection { cut(range) }
            return
        }
        selection = nil
    }

    private func updateItem<T: Identifiable & TimedItem>(_ keyPath: WritableKeyPath<EditSettings, [T]>, _ id: UUID, _ change: (inout T) -> Void) where T.ID == UUID {
        update { edit in
            guard let i = edit[keyPath: keyPath].firstIndex(where: { $0.id == id }) else { return }
            var item = edit[keyPath: keyPath][i]
            change(&item)
            (item.start, item.end) = clamped(item.start, item.end)
            edit[keyPath: keyPath][i] = item
        }
    }

    private func clamped(_ start: Double, _ end: Double) -> (Double, Double) {
        let s = max(0, min(start, end - 0.3))
        return (s, min(project.duration, max(end, s + 0.3)))
    }

    // MARK: Cut

    /// Removes a span of the output timeline from the video (ripple delete). Media-track
    /// items after it move left with the video.
    func cut(_ range: ClosedRange<Double>) {
        let a = max(range.lowerBound, 0), b = min(range.upperBound, outputDuration)
        guard b - a > 0.05 else { return }
        var kept: [EditSettings.Clip] = []
        for p in placements {
            let src = { (t: Double) in p.clip.start + (t - p.outputStart) * p.clip.speed }
            if p.outputEnd <= a || p.outputStart >= b { kept.append(p.clip); continue }
            if p.outputStart < a - 0.05 { kept.append(EditSettings.Clip(start: p.clip.start, end: src(a), speed: p.clip.speed)) }
            if p.outputEnd > b + 0.05 { kept.append(EditSettings.Clip(start: src(b), end: p.clip.end, speed: p.clip.speed)) }
        }
        guard !kept.isEmpty else { return }
        let length = b - a
        update { edit in
            edit.clips = kept
            edit.overlays = edit.overlays.compactMap { o in
                var o = o
                if o.start >= b { o.start -= length; o.end -= length }
                else if o.end > a {
                    // Overlapping the cut: keep the parts outside it, joined.
                    let removed = min(o.end, b) - max(o.start, a)
                    o.end -= removed
                    if o.start > a { o.mediaOffset += o.start - a; o.start = a }
                }
                return o.end - o.start > 0.1 ? o : nil
            }
        }
        rangeSelection = nil
        selection = nil
        seek(to: a)
    }

    // MARK: Media track

    /// Adds a video or image to the Media track at an output time. Videos keep their
    /// length (up to the end of the edit); images last 4 s.
    func addOverlay(_ url: URL, at outputTime: Double) {
        let isImage = UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) ?? false
        guard let name = copyIntoBundle(url, as: "media") else { return }
        let start = min(max(outputTime, 0), max(outputDuration - 0.5, 0))
        Task {
            var length = 4.0
            if !isImage, let duration = try? await AVURLAsset(url: bundle.appendingPathComponent(name)).load(.duration).seconds, duration > 0 {
                length = duration
            }
            let overlay = EditSettings.MediaOverlay(file: name, kind: isImage ? .image : .video, start: start,
                                                    end: min(start + length, max(outputDuration, start + 0.5)))
            update { $0.overlays.append(overlay) }
            selection = .overlay(overlay.id)
        }
    }

    /// Takes a clip off the main video and lays it over the video at `outputStart` on the
    /// Video 2 track (it plays inside the screen card, styled like the rest).
    func moveClipToVideo2(_ index: Int, at outputStart: Double) {
        guard keptClips.indices.contains(index), keptClips.count > 1 else { return }
        let clip = keptClips[index]
        let length = clip.end - clip.start
        update { edit in
            var kept = keptClips
            kept.remove(at: index)
            edit.clips = kept
            let remaining = kept.reduce(0) { $0 + ($1.end - $1.start) / $1.speed }
            let start = min(max(outputStart, 0), max(remaining - 0.5, 0))
            edit.overlays.append(EditSettings.MediaOverlay(file: RecordingProject.screenFile, kind: .video, start: start,
                                                           end: start + length, mediaOffset: clip.start, lane: 2))
        }
        if let added = edit.overlays.last { selection = .overlay(added.id) }
    }

    func chooseOverlay() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.movie, .image]
        panel.message = "Add a video or image to the Media track"
        if panel.runModal() == .OK, let url = panel.url { addOverlay(url, at: currentTime) }
    }

    func updateOverlay(_ id: UUID, _ change: (inout EditSettings.MediaOverlay) -> Void) {
        update { edit in
            guard let i = edit.overlays.firstIndex(where: { $0.id == id }) else { return }
            change(&edit.overlays[i])
        }
    }

    /// Moves/trims a media item on the output timeline. Trimming its start also skips
    /// into the video, so the content under the playhead doesn't jump.
    private func retimeOverlay(_ id: UUID, start: Double, end: Double) {
        updateOverlay(id) { o in
            let s = max(0, min(start, end - 0.2))
            if abs((end - start) - (o.end - o.start)) > 0.001, o.kind == .video { o.mediaOffset = max(0, o.mediaOffset + (s - o.start)) }
            o.start = s
            o.end = max(end, s + 0.2)
        }
    }

    // MARK: Files

    /// Uses an image as the background. System wallpapers are referenced in place;
    /// other files are copied into the project so it stays self-contained.
    func setBackgroundImage(_ url: URL) {
        if url.path.hasPrefix("/System/Library/Desktop Pictures") {
            update { $0.background = .image(url.path) }
        } else if let name = copyIntoBundle(url, as: "background") {
            update { $0.background = .image(name) }
        }
    }

    func setWatermark(_ url: URL) {
        guard let name = copyIntoBundle(url, as: "logo") else { return }
        update { $0.watermark = EditSettings.Watermark(file: name) }
    }

    func setMusic(_ url: URL, title: String? = nil) {
        guard let name = copyIntoBundle(url, as: "music") else { return }
        let title = title ?? url.deletingPathExtension().lastPathComponent
        update { $0.music = EditSettings.Music(file: name, title: title) }
        selection = .music
    }

    /// Asks for an audio file and uses it as the music bed.
    var showsMusicLibrary = false

    func chooseMusic() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.message = "Choose music to play under your video"
        if panel.runModal() == .OK, let url = panel.url { setMusic(url) }
    }

    private func copyIntoBundle(_ url: URL, as base: String) -> String? {
        let name = "\(base)-\(UUID().uuidString.prefix(6)).\(url.pathExtension.lowercased())"
        do {
            try FileManager.default.copyItem(at: url, to: bundle.appendingPathComponent(name))
            return name
        } catch {
            loadError = "Couldn't add \(url.lastPathComponent): \(error.localizedDescription)"
            return nil
        }
    }

    // MARK: Captions

    func generateCaptions(locale: Locale) {
        guard captionProgress == nil else { return }
        captionProgress = "Preparing audio…"
        let bundle = bundle, project = project
        Task {
            do {
                let words = try await CaptionGenerator.transcribe(bundle: bundle, project: project, locale: locale) { status in
                    Task { @MainActor in self.captionProgress = status }
                }
                update {
                    $0.captions.words = words
                    $0.captions.language = locale.identifier
                    $0.captions.enabled = true
                }
                if words.isEmpty { loadError = "No speech was found in this recording." }
            } catch {
                loadError = "Captions failed: \(error.localizedDescription)"
            }
            captionProgress = nil
        }
    }

    /// Replaces the words of one caption line, spreading its timing over the new words.
    func editCaptionLine(_ line: [EditSettings.CaptionWord], text: String) {
        guard let first = line.first, let last = line.last else { return }
        let parts = text.split(separator: " ").map(String.init)
        let step = (last.end - first.start) / Double(max(parts.count, 1))
        let replacement = parts.enumerated().map { i, word in
            EditSettings.CaptionWord(start: first.start + Double(i) * step, end: first.start + Double(i + 1) * step, text: word)
        }
        let ids = Set(line.map(\.id))
        update { edit in
            edit.captions.words.removeAll { ids.contains($0.id) }
            edit.captions.words.append(contentsOf: replacement)
            edit.captions.words.sort { $0.start < $1.start }
        }
    }

    func exportSubtitles(_ format: SubtitleFormat, to url: URL) {
        do {
            try SubtitleWriter.write(edit.captions.words, format: format, mapTime: { self.outputTime(for: $0) }, to: url)
        } catch {
            loadError = "Couldn't save subtitles: \(error.localizedDescription)"
        }
    }

    // MARK: Time mapping

    func clipIndex(at outputTime: Double) -> Int? {
        placements.lastIndex { outputTime >= $0.outputStart - 0.0001 }
    }

    func sourceTime(for outputTime: Double) -> Double? {
        guard let i = clipIndex(at: outputTime) else { return nil }
        let p = placements[i]
        return min(p.clip.start + (outputTime - p.outputStart) * p.clip.speed, p.clip.end)
    }

    /// Playback speed of the clip containing a source time (1 if it's cut out).
    func speed(atSource sourceTime: Double) -> Double {
        placements.first { sourceTime >= $0.clip.start && sourceTime <= $0.clip.end }?.clip.speed ?? 1
    }

    /// An item's span on the output timeline, following speed changes and clamped to
    /// the clip it starts in (nil if it starts in a cut-out part).
    func outputRange(start: Double, end: Double) -> ClosedRange<Double>? {
        guard let p = placements.first(where: { start >= $0.clip.start && start <= $0.clip.end }) else { return nil }
        let a = p.outputStart + (start - p.clip.start) / p.clip.speed
        let b = outputTime(for: end) ?? (p.outputStart + (min(end, p.clip.end) - p.clip.start) / p.clip.speed)
        return a...max(a, min(b, outputDuration))
    }

    func outputTime(for sourceTime: Double) -> Double? {
        placements.first { sourceTime >= $0.clip.start && sourceTime <= $0.clip.end }
            .map { $0.outputStart + (sourceTime - $0.clip.start) / $0.clip.speed }
    }

    // MARK: Playback

    func togglePlay() {
        if player.rate != 0 {
            player.pause()
        } else {
            if currentTime >= outputDuration - 0.05 { seek(to: 0) }
            player.play()
        }
        isPlaying = player.rate != 0
        refreshPreviewMode()
    }

    /// Horizontal zoom of the timeline (1 = whole video fits).
    var timelineZoom = 1.0
    /// Blade tool: clicking the timeline cuts there (scissors button, B; Escape leaves it).
    var bladeMode = false
    /// Voice loudness for the clip track (`Waveform.samplesPerSecond` per second of recording).
    private(set) var waveform: [Float] = []

    /// Tracks added from "Add track" that have nothing on them yet.
    var shownTracks: Set<TrackKind> = []

    /// Clip boundaries, for jumping between cuts.
    private var edges: [Double] { [0] + placements.map(\.outputEnd) }

    func previousEdge() -> Double { edges.filter { $0 < currentTime - 0.05 }.max() ?? 0 }
    func nextEdge() -> Double { edges.filter { $0 > currentTime + 0.05 }.min() ?? outputDuration }

    func seek(to time: Double) {
        let clamped = min(max(time, 0), outputDuration)
        currentTime = clamped
        // Recordings can start a few ms after 0; an exact seek there finds no frame and the
        // preview shows only the background, so let it land on the first frame instead.
        let after = clamped < 0.1 ? CMTime(seconds: 0.1, preferredTimescale: 6000) : .zero
        player.seek(to: CMTime(seconds: clamped, preferredTimescale: 6000), toleranceBefore: .zero, toleranceAfter: after)
    }

    // MARK: Export

    func export(resolution: Exporter.Resolution, fps: Int, format: Exporter.Format = .mp4) {
        guard exportProgress == nil else { return }
        exportProgress = 0
        lastExportURL = nil
        var project = project
        project.edit = edit
        let renderer = FrameRenderer(project: project, cursorData: cursorData, cursorImage: cursorImage, bundle: bundle)
        let bundle = bundle
        Task {
            do {
                let folder = try RecordingsLibrary.folderURL().appendingPathComponent("Exports", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let name = bundle.deletingPathExtension().lastPathComponent
                let destination = folder.appendingPathComponent("\(name) \(resolution.label)").appendingPathExtension(format.fileExtension)
                try await Exporter.export(bundle: bundle, renderer: renderer, resolution: resolution, fps: fps, format: format, to: destination) { value in
                    Task { @MainActor in self.exportProgress = value }
                }
                lastExportURL = destination
            } catch {
                loadError = "Export failed: \(error.localizedDescription)"
            }
            exportProgress = nil
        }
    }

    // MARK: Private

    /// While paused with a mask or a fixed-focus zoom selected, the preview is shown flat
    /// (no zoom or 3D move) so the handles line up with the screen. Playing always shows
    /// every effect.
    var editingOnPreview: Bool {
        guard player.rate == 0, let selection else { return false }
        switch selection {
        case .mask: return true
        case .zoom(let id): return zoomSegments.first { $0.id == id }?.focus != nil
        default: return false
        }
    }

    /// Rebuilds when the preview should switch between flat and full effects.
    private func refreshPreviewMode() {
        guard let renderer, renderer.applyZoomAndMoves == editingOnPreview else { return }
        rebuild(keepTime: true)
    }

    private var rebuildPending = false
    private var rebuildToken = UUID()

    private func rebuild(keepTime: Bool) {
        // During a drag, let the running rebuild finish and queue one more instead of
        // cancelling: the preview then keeps updating while the mouse moves.
        if gestureSnapshot != nil, rebuildTask != nil {
            rebuildPending = true
            return
        }
        rebuildTask?.cancel()
        var project = project
        project.edit = edit
        let renderer = FrameRenderer(project: project, cursorData: cursorData, cursorImage: cursorImage, bundle: bundle,
                                     applyZoomAndMoves: !editingOnPreview)
        let size = previewSize
        let bundle = bundle
        let wasPlaying = player.rate != 0

        let token = UUID()
        rebuildToken = token
        rebuildTask = Task {
            defer {
                // Only the latest rebuild clears the slot (a cancelled one may finish later).
                if rebuildToken == token {
                    rebuildTask = nil
                    if rebuildPending {
                        rebuildPending = false
                        rebuild(keepTime: true)
                    }
                }
            }
            do {
                let built = try await CompositionBuilder.build(bundle: bundle, renderer: renderer, renderSize: size)
                guard !Task.isCancelled else { return }
                placements = built.placements
                self.renderer = renderer
                let item = AVPlayerItem(asset: built.composition)
                item.videoComposition = built.videoComposition
                item.audioMix = built.audioMix
                item.audioTimePitchAlgorithm = .timeDomain
                player.replaceCurrentItem(with: item)
                // Read the playhead now, not when the rebuild started: it may have moved since.
                seek(to: min(keepTime ? currentTime : 0, built.duration))
                if wasPlaying { player.play() }
                loadError = nil
            } catch {
                loadError = "Couldn't open this recording: \(error.localizedDescription)"
            }
        }
    }

    /// Writes pending edits now (before something else reads project.json, like sharing).
    func saveNow() {
        saveTask?.cancel()
        project.edit = edit
        try? ProjectStore.write(project, to: bundle.appendingPathComponent(RecordingProject.fileName))
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            project.edit = edit
            try? ProjectStore.write(project, to: bundle.appendingPathComponent(RecordingProject.fileName))
        }
    }
}

/// Anything with a start and end on the source timeline.
protocol TimedItem {
    var start: Double { get set }
    var end: Double { get set }
}

extension EditSettings.ZoomSegment: TimedItem {}
extension EditSettings.PrivacyMask: TimedItem {}
extension EditSettings.SceneSegment: TimedItem {}
extension EditSettings.TextOverlay: TimedItem {}
extension EditSettings.CameraMove: TimedItem {}
