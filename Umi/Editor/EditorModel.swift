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
    private(set) var zoomSegments: [EditSettings.ZoomSegment] = []
    var outputDuration: Double { placements.last?.outputEnd ?? 0 }
    var selection: EditorSelection? {
        didSet { if editingOnPreview != (oldValue.map(Self.needsFlatPreview) ?? false) { rebuild(keepTime: true) } }
    }

    private(set) var exportProgress: Double?
    private(set) var lastExportURL: URL?
    private(set) var captionProgress: String?

    var undoManager: UndoManager?
    /// The renderer behind the current preview, for mapping overlay handles.
    private(set) var renderer: FrameRenderer?
    let previewSize: CGSize

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
        edit = project.edit ?? Self.defaults(for: project)
        previewSize = CompositionBuilder.renderSize(for: project, maxHeight: 1080)
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
    }

    /// First-open defaults: show the camera the way the bubble looked while recording.
    private static func defaults(for project: RecordingProject) -> EditSettings {
        var edit = EditSettings()
        if let bubble = project.camera?.bubble {
            edit.camera = bubble
        } else if let center = project.camera?.bubbleCenter {
            edit.camera.position = CGPoint(x: min(max(center.x, 0.08), 0.92), y: min(max(center.y, 0.1), 0.9))
        }
        return edit
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
        edit.zoom.segments = zoomSegments
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
        case .clip: break
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
        case nil: break
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

    func setMusic(_ url: URL) {
        guard let name = copyIntoBundle(url, as: "music") else { return }
        update { $0.music = EditSettings.Music(file: name) }
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
    }

    func seek(to time: Double) {
        let clamped = min(max(time, 0), outputDuration)
        currentTime = clamped
        player.seek(to: CMTime(seconds: clamped, preferredTimescale: 6000), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    // MARK: Export

    func export(resolution: Exporter.Resolution, fps: Int) {
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
                let destination = folder.appendingPathComponent("\(name) \(resolution.label)").appendingPathExtension("mp4")
                try await Exporter.export(bundle: bundle, renderer: renderer, resolution: resolution, fps: fps, to: destination) { value in
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

    /// Masks and fixed zoom focus are placed on the preview, so it's shown flat (no zoom
    /// or 3D move) while one is selected.
    var editingOnPreview: Bool { selection.map(Self.needsFlatPreview) ?? false }

    private static func needsFlatPreview(_ selection: EditorSelection) -> Bool {
        switch selection {
        case .mask, .zoom: true
        default: false
        }
    }

    private func rebuild(keepTime: Bool) {
        rebuildTask?.cancel()
        var project = project
        project.edit = edit
        let renderer = FrameRenderer(project: project, cursorData: cursorData, cursorImage: cursorImage, bundle: bundle,
                                     applyZoomAndMoves: !editingOnPreview)
        let size = previewSize
        let bundle = bundle
        let wasPlaying = player.rate != 0

        let throttle = gestureSnapshot != nil
        rebuildTask = Task {
            // While dragging, coalesce updates so the preview keeps up with the mouse.
            if throttle { try? await Task.sleep(for: .milliseconds(60)) }
            guard !Task.isCancelled else { return }
            do {
                let built = try await CompositionBuilder.build(bundle: bundle, renderer: renderer, renderSize: size)
                guard !Task.isCancelled else { return }
                placements = built.placements
                zoomSegments = renderer.zoomSegments
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
