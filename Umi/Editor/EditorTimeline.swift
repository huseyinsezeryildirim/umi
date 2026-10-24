import AVFoundation
import SwiftUI

/// The editor timeline: a ruler, the clip track (trim, split, speed, reorder) and one
/// track per kind of timed edit (zoom, scenes, masks, text, 3D moves).
struct EditorTimeline: View {
    let model: EditorModel

    static let labelWidth: CGFloat = 96
    static let trackHeight: CGFloat = 32
    static let clipHeight: CGFloat = 46

    var body: some View {
        GeometryReader { geo in
            let width = max(geo.size.width - Self.labelWidth - 16, 1)
            let scale = width / max(model.outputDuration, 0.1)

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 5) {
                    row(title: "", icon: nil) { RulerView(model: model, scale: scale, width: width) }
                    row(title: "Clips", icon: "film") { ClipTrack(model: model, scale: scale) }
                    track("Zoom", icon: "plus.magnifyingglass", add: { model.addZoom(at: model.currentTime) }, items: zoomItems, scale: scale)
                    track("Scenes", icon: "rectangle.split.2x1", menu: sceneMenu, items: sceneItems, scale: scale)
                    track("Masks", icon: "eye.slash", add: { model.addMask(at: model.currentTime) }, items: maskItems, scale: scale)
                    track("Text", icon: "textformat", menu: textMenu, items: textItems, scale: scale)
                    track("3D", icon: "cube", menu: moveMenu, items: moveItems, scale: scale)
                }
                .padding(.vertical, 6)
                .overlay(alignment: .topLeading) { playhead(scale: scale) }
                .coordinateSpace(.named("timeline"))
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .onDeleteCommand { model.deleteSelection() }
        .focusable()
        .focusEffectDisabled()
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
        .offset(x: Self.labelWidth + 8 + model.currentTime * scale - 7)
        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named("timeline")).onChanged { value in
            model.seek(to: (value.location.x - Self.labelWidth - 8) / scale)
        })
        .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
        .help("Drag to scrub")
    }

    // MARK: Rows

    private func label(_ title: String, icon: String?) -> some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .semibold)) }
            Text(title).font(.system(size: 11, weight: .medium))
        }
    }

    private func row<Content: View>(title: String, icon: String?, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 8) {
            HStack { label(title, icon: icon); Spacer(minLength: 0) }
                .foregroundStyle(.secondary)
                .frame(width: Self.labelWidth - 8, alignment: .leading)
                .padding(.leading, 8)
            content()
        }
    }

    private func track(_ title: String, icon: String, add: (() -> Void)? = nil, menu: [MenuEntry] = [],
                       items: [SegmentTrack.Item], scale: CGFloat) -> some View {
        HStack(spacing: 8) {
            HStack(spacing: 4) {
                label(title, icon: icon)
                Spacer(minLength: 0)
                addButton(title: title, add: add, menu: menu)
            }
            .foregroundStyle(.secondary)
            .frame(width: Self.labelWidth - 8, alignment: .leading)
            .padding(.leading, 8)
            SegmentTrack(model: model, items: items, scale: scale)
        }
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

    static func tickStep(for duration: Double) -> Double {
        switch duration {
        case ..<20: 0.5
        case ..<90: 1
        case ..<600: 5
        default: 15
        }
    }
}

private struct RulerView: View {
    let model: EditorModel
    let scale: CGFloat
    let width: CGFloat

    var body: some View {
        let step = EditorTimeline.tickStep(for: model.outputDuration)
        let duration = model.outputDuration
        Canvas { context, size in
            var t = 0.0
            while t <= duration + 0.001 {
                let x = t * scale
                let major = Int((t / step).rounded()) % 5 == 0
                var tick = Path()
                tick.move(to: CGPoint(x: x, y: size.height))
                tick.addLine(to: CGPoint(x: x, y: size.height - (major ? 9 : 4)))
                context.stroke(tick, with: .color(.secondary.opacity(0.7)), lineWidth: 1)
                if major {
                    context.draw(Text(t.formattedDuration).font(.system(size: 9)).foregroundStyle(.secondary), at: CGPoint(x: x + 2, y: 5), anchor: .leading)
                }
                t += step
            }
        }
        .frame(width: width, height: 20)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { model.seek(to: $0.location.x / scale) })
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
        let border: Color = selected ? UmiTheme.accent : Color.white.opacity(0.15)
        return shape
            .fill(UmiTheme.ink)
            .overlay { Filmstrip(screenURL: screen, clip: placement.clip).clipShape(shape) }
            .overlay(shape.fill(UmiTheme.ink.opacity(selected ? 0.25 : 0.45)))
            .overlay(shape.strokeBorder(border, lineWidth: selected ? 2 : 1))
            .overlay(alignment: .leading) { title(index, placement) }
            .overlay(alignment: .leading) { handle { trim(index, startDelta: $0) } }
            .overlay(alignment: .trailing) { handle { trim(index, endDelta: $0) } }
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

    private func handle(onDrag: @escaping (Double?) -> Void) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Color.white.opacity(0.85))
            .frame(width: 3, height: EditorTimeline.clipHeight - 16)
            .padding(.horizontal, 3)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
            .highPriorityGesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { onDrag($0.translation.width) }
                .onEnded { _ in onDrag(nil) })
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
            let count = max(Int(geo.size.width / 56), 1)
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
        generator.maximumSize = CGSize(width: height * 3, height: height * 2)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
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
        var id: EditorSelection { selection }
    }

    let model: EditorModel
    let items: [Item]
    let scale: CGFloat
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
            ForEach(items) { item in
                if let range = model.outputRange(start: item.start, end: item.end) {
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
        let stroke = StrokeStyle(lineWidth: selected ? 2 : 1, dash: item.dashed ? [4, 3] : [])
        return shape
            .fill(item.tint.opacity(fillOpacity))
            .overlay(shape.strokeBorder(item.tint.opacity(selected ? 1 : 0.55), style: stroke))
            .overlay(alignment: .leading) {
                Text(item.label)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 8)
            }
            .overlay(alignment: .leading) { edge(item, leading: true) }
            .overlay(alignment: .trailing) { edge(item, leading: false) }
            .contentShape(shape)
            .onTapGesture { model.selection = item.selection }
            .gesture(DragGesture(minimumDistance: 3, coordinateSpace: .global)
                .onChanged { value in drag(item, delta: value.translation.width, moveStart: true, moveEnd: true) }
                .onEnded { _ in endDrag() })
            .help(item.dashed ? "Auto zoom from a click. Drag, resize or delete to edit." : item.label)
    }

    private func edge(_ item: Item, leading: Bool) -> some View {
        Color.clear
            .frame(width: 7)
            .contentShape(Rectangle())
            .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
            .highPriorityGesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in drag(item, delta: value.translation.width, moveStart: leading, moveEnd: !leading) }
                .onEnded { _ in endDrag() })
    }

    private func drag(_ item: Item, delta: CGFloat, moveStart: Bool, moveEnd: Bool) {
        if origin == nil {
            origin = (item.start, item.end)
            model.beginGesture()
            model.selection = item.selection
        }
        guard let origin else { return }
        // Points are output time; items live in source time, which runs `speed` times faster.
        let seconds = Double(delta / scale) * model.speed(atSource: origin.start)
        model.retime(item.selection, start: moveStart ? origin.start + seconds : origin.start, end: moveEnd ? origin.end + seconds : origin.end)
    }

    private func endDrag() {
        origin = nil
        model.endGesture()
    }
}
