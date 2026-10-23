import AVFoundation
import Observation

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
    /// Output timeline (after cuts).
    private(set) var clips: [(source: TimeRangeValue, outputStart: Double)] = []
    private(set) var zoomSegments: [EditSettings.ZoomSegment] = []
    var outputDuration: Double { clips.last.map { $0.outputStart + $0.source.duration } ?? 0 }

    private(set) var exportProgress: Double?
    private(set) var lastExportURL: URL?

    var undoManager: UndoManager?

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

    /// First-open defaults: put the camera where the bubble was while recording.
    private static func defaults(for project: RecordingProject) -> EditSettings {
        var edit = EditSettings()
        if let center = project.camera?.bubbleCenter {
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

    // MARK: Timeline operations (output time)

    func split(at outputTime: Double) {
        guard let index = clipIndex(at: outputTime) else { return }
        let clip = clips[index]
        let cut = clip.source.start + (outputTime - clip.outputStart)
        guard cut - clip.source.start > 0.1, clip.source.end - cut > 0.1 else { return }
        update { edit in
            var kept = clips.map(\.source)
            kept.replaceSubrange(index...index, with: [
                TimeRangeValue(start: clip.source.start, end: cut),
                TimeRangeValue(start: cut, end: clip.source.end),
            ])
            edit.clips = kept
        }
    }

    func deleteClip(at index: Int) {
        guard clips.count > 1, clips.indices.contains(index) else { return }
        update { edit in
            var kept = clips.map(\.source)
            kept.remove(at: index)
            edit.clips = kept
        }
    }

    /// Moves one edge of a clip, in source time.
    func trimClip(at index: Int, start: Double? = nil, end: Double? = nil) {
        guard clips.indices.contains(index) else { return }
        update { edit in
            var kept = clips.map(\.source)
            let lower = index > 0 ? kept[index - 1].end : 0
            let upper = index + 1 < kept.count ? kept[index + 1].start : project.duration
            if let start { kept[index].start = min(max(start, lower), kept[index].end - 0.2) }
            if let end { kept[index].end = max(min(end, upper), kept[index].start + 0.2) }
            edit.clips = kept
        }
    }

    func addZoom(at outputTime: Double) {
        guard let source = sourceTime(for: outputTime) else { return }
        update { edit in
            materializeAutoZoom(&edit)
            edit.zoom.segments.append(.init(start: source, end: min(source + 3, project.duration), scale: edit.zoom.scale))
        }
    }

    func updateZoom(_ id: EditSettings.ZoomSegment.ID, _ change: (inout EditSettings.ZoomSegment) -> Void) {
        update { edit in
            materializeAutoZoom(&edit)
            guard let i = edit.zoom.segments.firstIndex(where: { $0.id == id }) else { return }
            change(&edit.zoom.segments[i])
            let s = edit.zoom.segments[i]
            edit.zoom.segments[i].start = max(0, min(s.start, s.end - 0.3))
            edit.zoom.segments[i].end = min(project.duration, max(s.end, edit.zoom.segments[i].start + 0.3))
        }
    }

    func deleteZoom(_ id: EditSettings.ZoomSegment.ID) {
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

    // MARK: Time mapping

    func clipIndex(at outputTime: Double) -> Int? {
        clips.lastIndex { outputTime >= $0.outputStart - 0.0001 }
    }

    func sourceTime(for outputTime: Double) -> Double? {
        guard let i = clipIndex(at: outputTime) else { return nil }
        return min(clips[i].source.start + (outputTime - clips[i].outputStart), clips[i].source.end)
    }

    func outputTime(for sourceTime: Double) -> Double? {
        clips.first { sourceTime >= $0.source.start && sourceTime <= $0.source.end }
            .map { $0.outputStart + (sourceTime - $0.source.start) }
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
        let renderer = FrameRenderer(project: project, cursorData: cursorData, cursorImage: cursorImage)
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

    private func rebuild(keepTime: Bool) {
        rebuildTask?.cancel()
        var project = project
        project.edit = edit
        let renderer = FrameRenderer(project: project, cursorData: cursorData, cursorImage: cursorImage)
        let size = CompositionBuilder.renderSize(for: project, maxHeight: 1080)
        let bundle = bundle
        let resumeAt = keepTime ? currentTime : 0
        let wasPlaying = player.rate != 0

        rebuildTask = Task {
            do {
                let built = try await CompositionBuilder.build(bundle: bundle, renderer: renderer, renderSize: size)
                guard !Task.isCancelled else { return }
                clips = built.clips
                zoomSegments = renderer.zoomSegments
                let item = AVPlayerItem(asset: built.composition)
                item.videoComposition = built.videoComposition
                player.replaceCurrentItem(with: item)
                seek(to: min(resumeAt, built.duration))
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
