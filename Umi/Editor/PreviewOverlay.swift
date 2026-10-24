import SwiftUI

/// Handles drawn over the preview for the selected item: a mask's box (drag to move,
/// corner to resize), a fixed zoom's focal point (click to set) and a text's anchor (drag).
struct PreviewOverlay: View {
    let model: EditorModel
    @State private var maskOrigin: CGRect?
    @State private var textOrigin: CGPoint?

    var body: some View {
        GeometryReader { geo in
            let video = Self.fit(model.previewSize, in: geo.size)
            ZStack(alignment: .topLeading) {
                Color.clear
                switch model.isPlaying ? nil : model.selection {
                case .mask(let id):
                    if let mask = model.edit.masks.first(where: { $0.id == id }), let content = contentRect(in: video) {
                        maskBox(mask, content: content)
                    }
                case .zoom(let id):
                    if let zoom = model.zoomSegments.first(where: { $0.id == id }), let focus = zoom.focus, let content = contentRect(in: video) {
                        focusPicker(id: id, focus: focus, content: content)
                    }
                case .text(let id):
                    if let text = model.edit.texts.first(where: { $0.id == id }) {
                        textHandle(text, video: video)
                    }
                default:
                    EmptyView()
                }
            }
            .coordinateSpace(.named("preview"))
        }
    }

    /// The video's rect inside the player (aspect fit).
    static func fit(_ size: CGSize, in box: CGSize) -> CGRect {
        let s = min(box.width / max(size.width, 1), box.height / max(size.height, 1))
        let w = size.width * s, h = size.height * s
        return CGRect(x: (box.width - w) / 2, y: (box.height - h) / 2, width: w, height: h)
    }

    /// The screen content rect in view coordinates (top-left origin).
    private func contentRect(in video: CGRect) -> CGRect? {
        guard let renderer = model.renderer, let t = model.sourceTime(for: model.currentTime) else { return nil }
        let canvas = CGRect(origin: .zero, size: model.previewSize)
        let r = renderer.screenContentRect(at: t, canvas: canvas)
        let sx = video.width / canvas.width, sy = video.height / canvas.height
        return CGRect(x: video.minX + r.minX * sx, y: video.minY + (canvas.height - r.maxY) * sy, width: r.width * sx, height: r.height * sy)
    }

    // MARK: Mask

    private func maskBox(_ mask: EditSettings.PrivacyMask, content: CGRect) -> some View {
        // Masks live in full-recording coordinates; the preview shows the cropped part.
        let c = model.edit.crop ?? CGRect(x: 0, y: 0, width: 1, height: 1)
        let full = CGRect(x: content.minX - c.minX / c.width * content.width, y: content.minY - c.minY / c.height * content.height,
                          width: content.width / c.width, height: content.height / c.height)
        let content = full
        let r = CGRect(x: content.minX + mask.rect.minX * content.width, y: content.minY + mask.rect.minY * content.height,
                       width: mask.rect.width * content.width, height: mask.rect.height * content.height)
        return ZStack(alignment: .bottomTrailing) {
            Rectangle()
                .fill(UmiTheme.accent.opacity(0.08))
                .overlay(Rectangle().strokeBorder(UmiTheme.accent, style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { v in
                        let start = beginMask(mask)
                        model.updateMask(mask.id) {
                            $0.rect.origin = CGPoint(x: min(max(start.minX + v.translation.width / content.width, 0), 1 - start.width),
                                                     y: min(max(start.minY + v.translation.height / content.height, 0), 1 - start.height))
                        }
                    }
                    .onEnded { _ in endMask() })
            Circle()
                .fill(.white)
                .overlay(Circle().strokeBorder(UmiTheme.accent, lineWidth: 2))
                .frame(width: 14, height: 14)
                .offset(x: 7, y: 7)
                .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { v in
                        let start = beginMask(mask)
                        model.updateMask(mask.id) {
                            $0.rect.size = CGSize(width: min(max(start.width + v.translation.width / content.width, 0.03), 1 - start.minX),
                                                  height: min(max(start.height + v.translation.height / content.height, 0.03), 1 - start.minY))
                        }
                    }
                    .onEnded { _ in endMask() })
        }
        .frame(width: r.width, height: r.height)
        .offset(x: r.minX, y: r.minY)
    }

    private func beginMask(_ mask: EditSettings.PrivacyMask) -> CGRect {
        if let maskOrigin { return maskOrigin }
        model.beginGesture()
        maskOrigin = mask.rect
        return mask.rect
    }

    private func endMask() {
        maskOrigin = nil
        model.endGesture()
    }

    // MARK: Zoom focus

    private func focusPicker(id: UUID, focus: CGPoint, content: CGRect) -> some View {
        ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(Color.white.opacity(0.001))
                .frame(width: content.width, height: content.height)
                .offset(x: content.minX, y: content.minY)
                .gesture(SpatialTapGesture(coordinateSpace: .named("preview")).onEnded { tap in
                    let p = CGPoint(x: min(max((tap.location.x - content.minX) / content.width, 0), 1),
                                    y: min(max((tap.location.y - content.minY) / content.height, 0), 1))
                    model.updateZoom(id) { $0.focus = p }
                })
            Image(systemName: "scope")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.6), radius: 3)
                .position(x: content.minX + focus.x * content.width, y: content.minY + focus.y * content.height)
                .allowsHitTesting(false)
        }
    }

    // MARK: Text

    private func textHandle(_ text: EditSettings.TextOverlay, video: CGRect) -> some View {
        Circle()
            .fill(Color.white)
            .overlay(Circle().strokeBorder(UmiTheme.accent, lineWidth: 3))
            .frame(width: 18, height: 18)
            .shadow(color: .black.opacity(0.4), radius: 3)
            .position(x: video.minX + text.position.x * video.width, y: video.minY + text.position.y * video.height)
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { v in
                    if textOrigin == nil { textOrigin = text.position; model.beginGesture() }
                    guard let start = textOrigin else { return }
                    model.updateText(text.id) {
                        $0.position = CGPoint(x: min(max(start.x + v.translation.width / video.width, 0.02), 0.98),
                                              y: min(max(start.y + v.translation.height / video.height, 0.02), 0.98))
                    }
                }
                .onEnded { _ in textOrigin = nil; model.endGesture() })
            .help("Drag to place the text")
    }
}
