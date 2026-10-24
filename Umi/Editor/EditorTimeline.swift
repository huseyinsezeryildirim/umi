import AVFoundation
import SwiftUI

/// Kinds of tracks that can be shown under the video.
enum TrackKind: String, CaseIterable, Hashable {
    case media, zoom, scenes, masks, text, moves, music

    var title: String {
        switch self {
        case .media: "Media"
        case .zoom: "Zoom"
        case .scenes: "Scenes"
        case .masks: "Masks"
        case .text: "Text"
        case .moves: "3D"
        case .music: "Music"
        }
    }

    var icon: String {
        switch self {
        case .media: "photo.on.rectangle"
        case .zoom: "plus.magnifyingglass"
        case .scenes: "rectangle.split.2x1"
        case .masks: "eye.slash"
        case .text: "textformat"
        case .moves: "cube"
        case .music: "music.note"
        }
    }
}

/// The editor timeline: a fixed column of track names, and to its right the ruler, the
/// video clip track and the tracks in use, scrollable and zoomable horizontally.
struct EditorTimeline: View {
    let model: EditorModel

    static let labelWidth: CGFloat = 104
    static let trackHeight: CGFloat = 32
    static let clipHeight: CGFloat = 50
    static let rulerHeight: CGFloat = 22
    static let spacing: CGFloat = 5

    var body: some View {
        GeometryReader { geo in
            let visible = max(geo.size.width - Self.labelWidth - 12, 1)
            let width = visible * model.timelineZoom
            let scale = width / max(model.outputDuration, 0.1)
            let tracks = TrackKind.allCases.filter(isVisible)

            ScrollView(.vertical) {
                HStack(alignment: .top, spacing: 0) {
                    VStack(alignment: .leading, spacing: Self.spacing) {
                        addTrackMenu.frame(height: Self.rulerHeight)
                        header("Video", icon: "film", height: Self.clipHeight)
                        ForEach(tracks, id: \.self) { kind in
                            header(kind.title, icon: kind.icon, height: Self.trackHeight, add: { add(kind) }, menu: menu(for: kind))
                        }
                    }
                    .frame(width: Self.labelWidth)
                    .padding(.vertical, 6)

                    ScrollView(.horizontal) {
                        VStack(alignment: .leading, spacing: Self.spacing) {
                            RulerView(model: model, scale: scale, width: width)
                            ClipTrack(model: model, scale: scale)
                            ForEach(tracks, id: \.self) { kind in
                                content(kind, scale: scale)
                            }
                        }
                        .frame(width: width + 6, alignment: .leading)
                        .padding(.vertical, 6)
                        .overlay(alignment: .topLeading) { rangeHighlight(scale: scale) }
                        .overlay(alignment: .topLeading) { playhead(scale: scale) }
                        .coordinateSpace(.named("timeline"))
                    }
                    .scrollIndicators(model.timelineZoom > 1 ? .visible : .hidden)
                }
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .onDeleteCommand { model.deleteSelection() }
        .focusable()
        .focusEffectDisabled()
    }

    // MARK: Tracks

    /// A track shows when it has something on it, or after it was added from the menu.
    private func isVisible(_ kind: TrackKind) -> Bool {
        if model.shownTracks.contains(kind) { return true }
        switch kind {
        case .media: return !model.edit.overlays.isEmpty
        case .zoom: return !model.zoomSegments.isEmpty
        case .scenes: return !model.edit.scenes.isEmpty
        case .masks: return !model.edit.masks.isEmpty
        case .text: return !model.edit.texts.isEmpty
        case .moves: return !model.edit.moves.isEmpty
        case .music: return model.edit.music != nil
        }
    }

    private var addTrackMenu: some View {
        Menu {
            ForEach(TrackKind.allCases.filter { !isVisible($0) }, id: \.self) { kind in
                Button { model.shownTracks.insert(kind) } label: { Label(kind.title, systemImage: kind.icon) }
            }
        } label: {
            Label("Add track", systemImage: "plus")
                .font(.system(size: 11, weight: .semibold))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Capsule().fill(UmiTheme.accent))
                .foregroundStyle(.white)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .padding(.leading, 8)
        .disabled(TrackKind.allCases.allSatisfy(isVisible))
        .help("Show another track")
    }

    private func add(_ kind: TrackKind) {
        switch kind {
        case .media: model.chooseOverlay()
        case .zoom: model.addZoom(at: model.currentTime)
        case .masks: model.addMask(at: model.currentTime)
        case .music: model.showsMusicLibrary = true
        case .scenes, .text, .moves: break
        }
    }

    private func menu(for kind: TrackKind) -> [MenuEntry] {
        switch kind {
        case .scenes: sceneMenu
        case .text: textMenu
        case .moves: moveMenu
        default: []
        }
    }

    @ViewBuilder
    private func content(_ kind: TrackKind, scale: CGFloat) -> some View {
        switch kind {
        case .media:
            SegmentTrack(model: model, items: mediaItems, scale: scale,
                         emptyHint: model.edit.overlays.isEmpty ? "Drop a video or image here, or click +" : nil)
                .onDrop(of: [.fileURL], isTargeted: nil) { providers, location in
                    for provider in providers {
                        _ = provider.loadObject(ofClass: URL.self) { url, _ in
                            guard let url else { return }
                            Task { @MainActor in model.addOverlay(url, at: Double(location.x / scale)) }
                        }
                    }
                    return true
                }
        case .zoom: SegmentTrack(model: model, items: zoomItems, scale: scale, emptyHint: hint(kind))
        case .scenes: SegmentTrack(model: model, items: sceneItems, scale: scale, emptyHint: hint(kind))
        case .masks: SegmentTrack(model: model, items: maskItems, scale: scale, emptyHint: hint(kind))
        case .text: SegmentTrack(model: model, items: textItems, scale: scale, emptyHint: hint(kind))
        case .moves: SegmentTrack(model: model, items: moveItems, scale: scale, emptyHint: hint(kind))
        case .music: MusicTrack(model: model, scale: scale)
        }
    }

    private func hint(_ kind: TrackKind) -> String? {
        isEmpty(kind) ? "Click + to add at the playhead" : nil
    }

    private func isEmpty(_ kind: TrackKind) -> Bool {
        switch kind {
        case .zoom: model.zoomSegments.isEmpty
        case .scenes: model.edit.scenes.isEmpty
        case .masks: model.edit.masks.isEmpty
        case .text: model.edit.texts.isEmpty
        case .moves: model.edit.moves.isEmpty
        default: false
        }
    }

    /// A track name tile on the left, with its + button.
    private func header(_ title: String, icon: String, height: CGFloat, add: (() -> Void)? = nil, menu: [MenuEntry] = []) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10.5, weight: .semibold))
            Text(title).font(.system(size: 11.5, weight: .semibold))
            Spacer(minLength: 0)
            if add != nil || !menu.isEmpty { addButton(title: title, add: menu.isEmpty ? add : nil, menu: menu) }
        }
        .foregroundStyle(.secondary)
        .padding(.horizontal, 9)
        .frame(height: height)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.06)))
        .padding(.horizontal, 6)
    }

    /// The span selected on the ruler: a yellow band over every track with a Cut button.
    @ViewBuilder
    private func rangeHighlight(scale: CGFloat) -> some View {
        if let range = model.rangeSelection {
            let x = range.lowerBound * scale
            let width = max((range.upperBound - range.lowerBound) * scale, 2)
            ZStack(alignment: .top) {
                Rectangle().fill(UmiTheme.trim.opacity(0.16))
                    .overlay(alignment: .leading) { Rectangle().fill(UmiTheme.trim).frame(width: 2) }
                    .overlay(alignment: .trailing) { Rectangle().fill(UmiTheme.trim).frame(width: 2) }
                    .allowsHitTesting(false)
                Button {
                    model.cut(range)
                } label: {
                    Label(String(format: "Cut %.1fs", range.upperBound - range.lowerBound), systemImage: "scissors")
                        .font(.system(size: 10, weight: .bold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(UmiTheme.trim))
                        .foregroundStyle(Color.black)
                        .fixedSize()
                }
                .buttonStyle(.plain)
                .offset(y: 24)
                .help("Remove this part (⌫)")
            }
            .frame(width: width)
            .offset(x: x)
        }
    }

    /// The playhead: a thin line with a grab handle on the ruler. The whole 14 pt strip
    /// around the line is draggable, not just the line.
    private func playhead(scale: CGFloat) -> some View {
        ZStack(alignment: .top) {
            Rectangle().fill(UmiTheme.record).frame(width: 2)
            UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 7, bottomTrailingRadius: 7, topTrailingRadius: 3)
                .fill(UmiTheme.record)
                .frame(width: 14, height: 18)
                .shadow(color: .black.opacity(0.3), radius: 1.5, y: 1)
        }
        .frame(width: 14)
        .contentShape(Rectangle())
        .offset(x: model.currentTime * scale - 7)
        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named("timeline")).onChanged { value in
            model.seek(to: value.location.x / scale)
        })
        .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
        .help("Drag to scrub")
    }

    @ViewBuilder
    private func addButton(title: String, add: (() -> Void)?, menu: [MenuEntry]) -> some View {
        if let add {
            Button(action: add) { Image(systemName: "plus").font(.system(size: 10, weight: .bold)) }
                .buttonStyle(.borderless)
                .help("Add \(title.lowercased()) at the playhead")
        } else {
            Menu {
                ForEach(menu) { entry in Button(entry.title, action: entry.action) }
            } label: {
                Image(systemName: "plus").font(.system(size: 10, weight: .bold))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Add \(title.lowercased()) at the playhead")
        }
    }

    // MARK: Items

    struct MenuEntry: Identifiable {
        var title: String
        var action: () -> Void
        var id: String { title }
    }

    private var sceneMenu: [MenuEntry] {
        EditSettings.SceneLayout.allCases.filter { $0 != .default }.map { layout in
            MenuEntry(title: layout.label) { model.addScene(layout, at: model.currentTime) }
        }
    }

    private var textMenu: [MenuEntry] {
        EditSettings.TextStyle.allCases.map { style in MenuEntry(title: style.label) { model.addText(style, at: model.currentTime) } }
    }

    private var moveMenu: [MenuEntry] {
        EditSettings.MoveKind.allCases.map { kind in MenuEntry(title: kind.label) { model.addMove(kind, at: model.currentTime) } }
    }

    private var zoomItems: [SegmentTrack.Item] {
        let manual = Set(model.edit.zoom.segments.map(\.id))
        return model.zoomSegments.map { z in
            let label = String(format: "%.1f×", z.scale) + (z.focus == nil ? "" : " · fixed")
            return SegmentTrack.Item(selection: .zoom(z.id), start: z.start, end: z.end, label: label,
                                     tint: UmiTheme.accent, dashed: model.edit.zoom.auto && !manual.contains(z.id))
        }
    }

    private var mediaItems: [SegmentTrack.Item] {
        model.edit.overlays.map {
            SegmentTrack.Item(selection: .overlay($0.id), start: $0.start, end: $0.end,
                              label: ($0.mode == .pictureInPicture ? "PiP · " : "") + $0.file, tint: Color(hex: 0x0CA678), outputTime: true)
        }
    }

    private var sceneItems: [SegmentTrack.Item] {
        model.edit.scenes.map { SegmentTrack.Item(selection: .scene($0.id), start: $0.start, end: $0.end, label: $0.layout.label, tint: Color(hex: 0x7A5AF8)) }
    }

    private var maskItems: [SegmentTrack.Item] {
        model.edit.masks.map { SegmentTrack.Item(selection: .mask($0.id), start: $0.start, end: $0.end, label: $0.style.rawValue.capitalized, tint: Color(hex: 0x4A4F58)) }
    }

    private var textItems: [SegmentTrack.Item] {
        model.edit.texts.map { SegmentTrack.Item(selection: .text($0.id), start: $0.start, end: $0.end, label: $0.text, tint: Color(hex: 0x0E9F6E)) }
    }

    private var moveItems: [SegmentTrack.Item] {
        model.edit.moves.map { SegmentTrack.Item(selection: .move($0.id), start: $0.start, end: $0.end, label: $0.kind.label, tint: Color(hex: 0xE8590C)) }
    }

    /// Seconds between labelled ticks, so labels stay ~80pt apart at any zoom.
    static func majorStep(pointsPerSecond: CGFloat) -> Double {
        let steps: [Double] = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
        return steps.first { $0 * Double(pointsPerSecond) >= 80 } ?? 600
    }

    /// "0:05", or "0:02.5" when labels fall between whole seconds.
    static func rulerLabel(_ t: Double, step: Double) -> String {
        let minutes = Int(t) / 60, seconds = t - Double(minutes * 60)
        return step < 1 ? String(format: "%d:%04.1f", minutes, seconds) : String(format: "%d:%02d", minutes, Int(seconds.rounded()))
    }
}

private struct RulerView: View {
    let model: EditorModel
    let scale: CGFloat
    let width: CGFloat

    var body: some View {
        let major = EditorTimeline.majorStep(pointsPerSecond: scale)
        let step = major / 5
        let duration = model.outputDuration
        Canvas { context, size in
            var i = 0
            while Double(i) * step <= duration + 0.001 {
                let t = Double(i) * step
                let x = t * scale
                let isMajor = i % 5 == 0
                var tick = Path()
                tick.move(to: CGPoint(x: x, y: size.height))
                tick.addLine(to: CGPoint(x: x, y: size.height - (isMajor ? 9 : 4)))
                context.stroke(tick, with: .color(.secondary.opacity(0.7)), lineWidth: 1)
                if isMajor {
                    context.draw(Text(EditorTimeline.rulerLabel(t, step: major)).font(.system(size: 9).monospacedDigit()).foregroundStyle(.secondary),
                                 at: CGPoint(x: x + 3, y: 5), anchor: .leading)
                }
                i += 1
            }
        }
        .frame(width: width, height: 20)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { value in
                // Dragging along the ruler selects a span to cut; a click just seeks.
                guard abs(value.translation.width) > 4 else { return }
                let a = Double(value.startLocation.x / scale), b = Double(value.location.x / scale)
                model.selection = nil
                model.rangeSelection = max(0, min(a, b))...min(model.outputDuration, max(a, b))
            }
            .onEnded { value in
                if abs(value.translation.width) <= 4 {
                    model.rangeSelection = nil
                    model.seek(to: Double(value.location.x / scale))
                }
            })
        .help("Click to move the playhead. Drag to select a part to cut.")
    }
}

// MARK: - Clip track

private struct ClipTrack: View {
    let model: EditorModel
    let scale: CGFloat
    @State private var trimOrigin: (start: Double, end: Double)?
    @State private var reorder: (index: Int, offset: CGFloat)?

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(model.placements.enumerated()), id: \.offset) { index, placement in
                clip(index, placement)
            }
        }
        .frame(height: EditorTimeline.clipHeight, alignment: .topLeading)
    }

    private func clip(_ index: Int, _ placement: CompositionBuilder.Placement) -> some View {
        let offset: CGFloat = reorder?.index == index ? (reorder?.offset ?? 0) : 0
        let width: CGFloat = max(CGFloat(placement.outputDuration) * scale - 2, 6)
        let x: CGFloat = CGFloat(placement.outputStart) * scale + 1 + offset
        return clipBody(index, placement)
            .frame(width: width, height: EditorTimeline.clipHeight)
            .offset(x: x)
            .zIndex(reorder?.index == index ? 1 : 0)
            .onTapGesture { model.selection = .clip(index) }
            .gesture(reorderGesture(index, placement))
    }

    private func clipBody(_ index: Int, _ placement: CompositionBuilder.Placement) -> some View {
        let selected = model.selection == .clip(index)
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        let screen = model.bundle.appendingPathComponent(RecordingProject.screenFile)
        let border: Color = selected ? UmiTheme.trim : Color.white.opacity(0.15)
        return shape
            .fill(UmiTheme.ink)
            .overlay { Filmstrip(screenURL: screen, clip: placement.clip).clipShape(shape) }
            .overlay(shape.fill(UmiTheme.ink.opacity(selected ? 0.25 : 0.45)))
            .overlay(alignment: .bottom) { ClipWaveform(peaks: model.waveform, clip: placement.clip).frame(height: 16).padding(.bottom, 3).clipShape(shape) }
            .overlay(shape.strokeBorder(border, lineWidth: selected ? 2.5 : 1))
            .overlay(alignment: .leading) { title(index, placement).padding(.leading, 4) }
            .overlay(alignment: .leading) {
                TrimHandle(leading: true, selected: selected, height: EditorTimeline.clipHeight) { trim(index, startDelta: $0.map(Double.init)) }
            }
            .overlay(alignment: .trailing) {
                TrimHandle(leading: false, selected: selected, height: EditorTimeline.clipHeight) { trim(index, endDelta: $0.map(Double.init)) }
            }
    }

    private func reorderGesture(_ index: Int, _ placement: CompositionBuilder.Placement) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                reorder = (index, value.translation.width)
                model.selection = .clip(index)
            }
            .onEnded { value in
                let center = placement.outputStart + placement.outputDuration / 2 + Double(value.translation.width / scale)
                let target = model.placements.lastIndex { $0.outputStart <= center } ?? 0
                reorder = nil
                model.moveClip(from: index, to: target)
            }
    }

    private func title(_ index: Int, _ placement: CompositionBuilder.Placement) -> some View {
        HStack(spacing: 4) {
            Text("Clip \(index + 1)").font(.system(size: 10, weight: .semibold))
            if placement.clip.speed != 1 {
                Text(Self.speedLabel(placement.clip.speed))
                    .font(.system(size: 9, weight: .bold))
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(Capsule().fill(UmiTheme.accent))
            }
        }
        .foregroundStyle(.white)
        .padding(.leading, 12)
        .lineLimit(1)
    }

    /// `delta` in points; nil ends the drag.
    private func trim(_ index: Int, startDelta: Double? = nil, endDelta: Double? = nil) {
        guard model.placements.indices.contains(index) else { return }
        if startDelta == nil && endDelta == nil {
            trimOrigin = nil
            model.endGesture()
            return
        }
        let clip = model.placements[index].clip
        if trimOrigin == nil {
            trimOrigin = (clip.start, clip.end)
            model.beginGesture()
        }
        guard let origin = trimOrigin else { return }
        let perPoint = clip.speed / Double(scale)
        if let startDelta { model.trimClip(at: index, start: origin.start + startDelta * perPoint) }
        if let endDelta { model.trimClip(at: index, end: origin.end + endDelta * perPoint) }
    }

    static func speedLabel(_ speed: Double) -> String {
        speed == speed.rounded() ? "\(Int(speed))×" : String(format: "%g×", speed)
    }
}

/// Thumbnails of the screen across a clip, tiled to fill its width.
private struct Filmstrip: View {
    let screenURL: URL
    let clip: EditSettings.Clip
    @State private var images: [NSImage] = []

    var body: some View {
        GeometryReader { geo in
            // One thumbnail per ~56pt, capped so deep zooms stay quick to load.
            let count = min(max(Int(geo.size.width / 56), 1), 120)
            HStack(spacing: 0) {
                ForEach(images.indices, id: \.self) { i in
                    Image(nsImage: images[i]).resizable().aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width / CGFloat(max(images.count, 1)), height: geo.size.height)
                        .clipped()
                }
            }
            .task(id: "\(clip.start)-\(clip.end)-\(count)") { await load(count: count, height: geo.size.height) }
        }
    }

    private func load(count: Int, height: CGFloat) async {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: screenURL))
        // Retina: twice the point size, so thumbnails stay sharp.
        generator.maximumSize = CGSize(width: height * 6, height: height * 4)
        // Tight tolerance when zoomed in (thumbnails close in time), loose otherwise.
        let spacing = clip.duration / Double(max(count, 1))
        let tolerance = CMTime(seconds: min(0.5, spacing / 2), preferredTimescale: 600)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        var result: [NSImage] = []
        for i in 0..<count {
            let t = clip.start + (clip.duration * (Double(i) + 0.5) / Double(count))
            if let (cg, _) = try? await generator.image(at: CMTime(seconds: t, preferredTimescale: 600)) {
                result.append(NSImage(cgImage: cg, size: .zero))
            }
            if Task.isCancelled { return }
        }
        images = result
    }
}

/// The music bed: one chip under the whole video (it loops to fit).
private struct MusicTrack: View {
    let model: EditorModel
    let scale: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        ZStack(alignment: .topLeading) {
            shape.fill(Color.secondary.opacity(0.07))
                .frame(height: EditorTimeline.trackHeight)
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { model.showsMusicLibrary = true }
            if let music = model.edit.music {
                let selected = model.selection == .music
                let tint = Color(hex: 0xD6336C)
                shape.fill(tint.opacity(selected ? 0.42 : 0.28))
                    .overlay(shape.strokeBorder(tint.opacity(selected ? 1 : 0.55), lineWidth: selected ? 2 : 1))
                    .overlay(alignment: .leading) {
                        Label("\(music.title ?? music.file) · \(Int(music.volume * 100))%", systemImage: "waveform")
                            .font(.system(size: 10, weight: .semibold))
                            .lineLimit(1)
                            .padding(.horizontal, 8)
                    }
                    .frame(width: max(model.outputDuration * Double(scale) - 2, 14), height: EditorTimeline.trackHeight)
                    .offset(x: 1)
                    .contentShape(shape)
                    .onTapGesture { model.selection = .music }
                    .help("Music. Select to change volume, Delete to remove.")
            } else {
                Text("Click + to add music")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 8)
                    .frame(height: EditorTimeline.trackHeight)
                    .allowsHitTesting(false)
            }
        }
        .frame(height: EditorTimeline.trackHeight, alignment: .topLeading)
    }
}

// MARK: - Segment track

/// A row of timed items (source-time ranges drawn on the output timeline) that can be
/// selected, moved and resized.
struct SegmentTrack: View {
    struct Item: Identifiable {
        var selection: EditorSelection
        var start: Double
        var end: Double
        var label: String
        var tint: Color
        var dashed = false
        /// Timed on the output timeline (Media track) rather than the recording.
        var outputTime = false
        var id: EditorSelection { selection }
    }

    let model: EditorModel
    let items: [Item]
    let scale: CGFloat
    var emptyHint: String?
    @State private var origin: (start: Double, end: Double)?

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.secondary.opacity(0.07))
                .frame(height: EditorTimeline.trackHeight)
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { tap in
                    model.selection = nil
                    model.seek(to: Double(tap.location.x / scale))
                })
            if let emptyHint {
                Text(emptyHint)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 8)
                    .frame(height: EditorTimeline.trackHeight)
                    .allowsHitTesting(false)
            }
            ForEach(items) { item in
                if let range = item.outputTime ? item.start...max(item.start, item.end) : model.outputRange(start: item.start, end: item.end) {
                    chip(item)
                        .frame(width: max((range.upperBound - range.lowerBound) * Double(scale) - 2, 14), height: EditorTimeline.trackHeight)
                        .offset(x: range.lowerBound * Double(scale) + 1)
                }
            }
        }
        .frame(height: EditorTimeline.trackHeight, alignment: .topLeading)
    }

    private func chip(_ item: Item) -> some View {
        let selected = model.selection == item.selection
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        let fillOpacity = item.dashed ? 0.18 : selected ? 0.42 : 0.28
        let stroke = StrokeStyle(lineWidth: selected ? 2.5 : 1, dash: item.dashed && !selected ? [4, 3] : [])
        return shape
            .fill(item.tint.opacity(fillOpacity))
            .overlay(shape.strokeBorder(selected ? UmiTheme.trim : item.tint.opacity(0.55), style: stroke))
            .overlay(alignment: .leading) {
                Text(item.label)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 12)
            }
            .overlay(alignment: .leading) { edge(item, leading: true, selected: selected) }
            .overlay(alignment: .trailing) { edge(item, leading: false, selected: selected) }
            .contentShape(shape)
            .onTapGesture { model.selection = item.selection }
            .gesture(DragGesture(minimumDistance: 3, coordinateSpace: .global)
                .onChanged { value in drag(item, delta: value.translation.width, moveStart: true, moveEnd: true) }
                .onEnded { _ in endDrag() })
            .help(item.dashed ? "Auto zoom from a click. Drag, resize or delete to edit." : item.label)
    }

    private func edge(_ item: Item, leading: Bool, selected: Bool) -> some View {
        TrimHandle(leading: leading, selected: selected, height: EditorTimeline.trackHeight) { delta in
            if let delta { drag(item, delta: delta, moveStart: leading, moveEnd: !leading) } else { endDrag() }
        }
    }

    private func drag(_ item: Item, delta: CGFloat, moveStart: Bool, moveEnd: Bool) {
        if origin == nil {
            origin = (item.start, item.end)
            model.beginGesture()
            model.selection = item.selection
        }
        guard let origin else { return }
        // Points are output time; items live in source time, which runs `speed` times faster.
        let seconds = Double(delta / scale) * (item.outputTime ? 1 : model.speed(atSource: origin.start))
        model.retime(item.selection, start: moveStart ? origin.start + seconds : origin.start, end: moveEnd ? origin.end + seconds : origin.end)
    }

    private func endDrag() {
        origin = nil
        model.endGesture()
    }
}

/// A trim handle on a timeline item's edge, like other video editors: a yellow bar with a
/// grip that shows on hover, on the selected item and while dragging (when it glows).
private struct TrimHandle: View {
    let leading: Bool
    let selected: Bool
    let height: CGFloat
    /// Drag distance in points; nil when the drag ends.
    let onDrag: (CGFloat?) -> Void
    @State private var hovering = false
    @State private var dragging = false

    var body: some View {
        let visible = selected || hovering || dragging
        let shape = UnevenRoundedRectangle(topLeadingRadius: leading ? 6 : 0, bottomLeadingRadius: leading ? 6 : 0,
                                           bottomTrailingRadius: leading ? 0 : 6, topTrailingRadius: leading ? 0 : 6, style: .continuous)
        ZStack {
            shape.fill(UmiTheme.trim)
            Capsule().fill(Color.black.opacity(0.55)).frame(width: 2, height: height * 0.42)
        }
        .frame(width: dragging || hovering ? 11 : 9)
        .opacity(visible ? 1 : 0)
        .shadow(color: UmiTheme.trim.opacity(dragging ? 0.9 : 0), radius: 6)
        .animation(.easeOut(duration: 0.12), value: visible)
        .animation(.easeOut(duration: 0.12), value: dragging)
        .contentShape(Rectangle())
        .onHover { inside in
            hovering = inside
            if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
        }
        .highPriorityGesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                dragging = true
                onDrag(value.translation.width)
            }
            .onEnded { _ in
                dragging = false
                onDrag(nil)
            })
        .help("Drag to trim")
    }
}

/// The voice track's loudness under a clip, drawn as thin bars.
private struct ClipWaveform: View {
    let peaks: [Float]
    let clip: EditSettings.Clip

    var body: some View {
        Canvas { context, size in
            guard !peaks.isEmpty else { return }
            let first = Int(clip.start * Waveform.samplesPerSecond), last = min(Int(clip.end * Waveform.samplesPerSecond), peaks.count)
            guard last > first else { return }
            let bars = max(Int(size.width / 3), 1)
            for bar in 0..<bars {
                let a = first + (last - first) * bar / bars, b = max(first + (last - first) * (bar + 1) / bars, a + 1)
                let peak = peaks[a..<min(b, peaks.count)].max() ?? 0
                let h = max(1.5, CGFloat(peak) * size.height)
                context.fill(Path(roundedRect: CGRect(x: CGFloat(bar) * 3, y: size.height - h, width: 2, height: h), cornerRadius: 1),
                             with: .color(.white.opacity(0.55)))
            }
        }
        .allowsHitTesting(false)
    }
}
