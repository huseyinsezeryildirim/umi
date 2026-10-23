import SwiftUI

/// Clips (cut/trim) and zoom segments on the output timeline, with a playhead.
struct EditorTimeline: View {
    let model: EditorModel
    @State private var selection: Selection?
    @State private var dragOrigin: DragOrigin?

    private enum Selection: Equatable {
        case clip(Int)
        case zoom(UUID)
    }

    private struct DragOrigin {
        var start: Double
        var end: Double
    }

    private let rulerHeight: CGFloat = 22
    private let trackHeight: CGFloat = 40
    private let handleWidth: CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            let width = max(geo.size.width - 24, 1)
            let scale = width / max(model.outputDuration, 0.1)

            ZStack(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 6) {
                    ruler(scale: scale, width: width)
                    clipTrack(scale: scale)
                    zoomTrack(scale: scale)
                }
                .padding(.horizontal, 12)
                .padding(.top, 6)

                playhead(scale: scale, height: geo.size.height)
            }
            .contentShape(Rectangle())
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .onDeleteCommand { deleteSelection() }
        .focusable()
        .focusEffectDisabled()
    }

    // MARK: Ruler + playhead

    private func ruler(scale: CGFloat, width: CGFloat) -> some View {
        let step = Self.tickStep(for: model.outputDuration)
        return Canvas { context, size in
            var t = 0.0
            while t <= model.outputDuration + 0.001 {
                let x = t * scale
                let major = Int((t / step).rounded()) % 5 == 0
                context.stroke(Path { $0.move(to: CGPoint(x: x, y: size.height)); $0.addLine(to: CGPoint(x: x, y: size.height - (major ? 10 : 5))) },
                               with: .color(.secondary), lineWidth: 1)
                if major {
                    context.draw(Text(t.formattedDuration).font(.system(size: 9)).foregroundStyle(.secondary),
                                 at: CGPoint(x: x + 2, y: 6), anchor: .leading)
                }
                t += step
            }
        }
        .frame(width: width, height: rulerHeight)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { value in
            model.seek(to: value.location.x / scale)
        })
    }

    private func playhead(scale: CGFloat, height: CGFloat) -> some View {
        Rectangle()
            .fill(Color.red)
            .frame(width: 2, height: height - 4)
            .overlay(alignment: .top) {
                Circle().fill(Color.red).frame(width: 10, height: 10).offset(y: -2)
            }
            .offset(x: 12 + model.currentTime * scale - 1, y: 4)
            .allowsHitTesting(false)
    }

    // MARK: Clips

    private func clipTrack(scale: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(model.clips.enumerated()), id: \.offset) { index, clip in
                let selected = selection == .clip(index)
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.accentColor.opacity(selected ? 0.55 : 0.32))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(selected ? Color.accentColor : .clear, lineWidth: 2))
                    .overlay(alignment: .leading) { Label("Clip", systemImage: "film").font(.caption2).padding(.leading, 12).labelStyle(.iconOnly) }
                    .overlay(alignment: .leading) { trimHandle { delta in trim(index, scale: scale, startDelta: delta) } }
                    .overlay(alignment: .trailing) { trimHandle { delta in trim(index, scale: scale, endDelta: delta) } }
                    .frame(width: max(clip.source.duration * scale - 2, 4), height: trackHeight)
                    .offset(x: clip.outputStart * scale + 1)
                    .onTapGesture {
                        selection = .clip(index)
                    }
            }
        }
        .frame(height: trackHeight, alignment: .topLeading)
    }

    private func trimHandle(onDrag: @escaping (Double?) -> Void) -> some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(Color.white.opacity(0.85))
            .frame(width: handleWidth - 4, height: trackHeight - 14)
            .padding(.horizontal, 2)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in onDrag(value.translation.width) }
                .onEnded { _ in onDrag(nil) })
    }

    /// `delta` in points; nil ends the drag.
    private func trim(_ index: Int, scale: CGFloat, startDelta: Double? = nil, endDelta: Double? = nil) {
        guard model.clips.indices.contains(index) else { return }
        if startDelta == nil && endDelta == nil {
            dragOrigin = nil
            model.endGesture()
            return
        }
        if dragOrigin == nil {
            dragOrigin = DragOrigin(start: model.clips[index].source.start, end: model.clips[index].source.end)
            model.beginGesture()
        }
        guard let origin = dragOrigin else { return }
        if let startDelta { model.trimClip(at: index, start: origin.start + startDelta / scale) }
        if let endDelta { model.trimClip(at: index, end: origin.end + endDelta / scale) }
    }

    // MARK: Zoom

    private func zoomTrack(scale: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.secondary.opacity(0.08))
                .frame(height: trackHeight)
                .onTapGesture(count: 2) { location in
                    model.addZoom(at: location.x / scale)
                }
            ForEach(model.zoomSegments) { segment in
                if let start = model.outputTime(for: segment.start) {
                    let end = model.outputTime(for: segment.end) ?? (start + segment.end - segment.start)
                    let selected = selection == .zoom(segment.id)
                    let generated = model.edit.zoom.auto && !model.edit.zoom.segments.contains { $0.id == segment.id }
                    ZoomChip(segment: segment, selected: selected, generated: generated)
                        .frame(width: max((end - start) * scale - 2, 12), height: trackHeight)
                        .offset(x: start * scale + 1)
                        .onTapGesture { selection = .zoom(segment.id) }
                        .gesture(DragGesture(minimumDistance: 3, coordinateSpace: .global)
                            .onChanged { value in moveZoom(segment, by: value.translation.width / scale) }
                            .onEnded { _ in dragOrigin = nil; model.endGesture() })
                }
            }
        }
        .frame(height: trackHeight, alignment: .topLeading)
    }

    private func moveZoom(_ segment: EditSettings.ZoomSegment, by seconds: Double) {
        if dragOrigin == nil {
            dragOrigin = DragOrigin(start: segment.start, end: segment.end)
            model.beginGesture()
            selection = .zoom(segment.id)
        }
        guard let origin = dragOrigin else { return }
        model.updateZoom(segment.id) { s in
            s.start = origin.start + seconds
            s.end = origin.end + seconds
        }
    }

    private func deleteSelection() {
        switch selection {
        case .clip(let index): model.deleteClip(at: index)
        case .zoom(let id): model.deleteZoom(id)
        case nil: break
        }
        selection = nil
    }

    // MARK: Helpers

    private static func tickStep(for duration: Double) -> Double {
        switch duration {
        case ..<20: 0.5
        case ..<90: 1
        case ..<600: 5
        default: 15
        }
    }
}

private struct ZoomChip: View {
    let segment: EditSettings.ZoomSegment
    let selected: Bool
    let generated: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(Color.purple.opacity(generated ? 0.25 : 0.45))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(selected ? Color.purple : Color.purple.opacity(0.5), style: StrokeStyle(lineWidth: selected ? 2 : 1, dash: generated ? [4, 3] : []))
            )
            .overlay(alignment: .leading) {
                Label(String(format: "%.1f×", segment.scale), systemImage: "plus.magnifyingglass")
                    .font(.caption2.weight(.semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 6)
            }
            .help(generated ? "Auto zoom (from clicks). Drag or delete to edit." : "Zoom")
    }
}
