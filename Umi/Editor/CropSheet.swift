import AVFoundation
import SwiftUI

/// Crop the screen recording: drag the box (or its corners) over a still of the screen,
/// optionally locked to an aspect ratio.
struct CropSheet: View {
    let model: EditorModel
    @Environment(\.dismiss) private var dismiss
    @State private var rect = CGRect(x: 0, y: 0, width: 1, height: 1)
    @State private var lock: Double?
    @State private var still: NSImage?
    @State private var dragOrigin: CGRect?

    private let locks: [(String, Double?)] = [("Free", nil), ("16:9", 16.0 / 9), ("1:1", 1), ("9:16", 9.0 / 16), ("4:3", 4.0 / 3)]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Crop").font(.title2.bold())
                Spacer()
                Picker("", selection: Binding(get: { lock ?? 0 }, set: { lock = $0 == 0 ? nil : $0; applyLock() })) {
                    ForEach(locks, id: \.0) { Text($0.0).tag($0.1 ?? 0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            }

            GeometryReader { geo in
                let box = fit(geo.size)
                ZStack(alignment: .topLeading) {
                    if let still {
                        Image(nsImage: still).resizable().frame(width: box.width, height: box.height)
                    } else {
                        Rectangle().fill(.quaternary).frame(width: box.width, height: box.height)
                    }
                    cropOverlay(box)
                }
                .frame(width: box.width, height: box.height)
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
            }
            .frame(height: 380)

            HStack {
                Text("\(Int(rect.width * Double(model.project.screen.pixelWidth))) × \(Int(rect.height * Double(model.project.screen.pixelHeight))) px")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                Button("Reset") { rect = CGRect(x: 0, y: 0, width: 1, height: 1); lock = nil }
                Button("Cancel") { dismiss() }
                Button("Apply") {
                    let full = rect.width > 0.995 && rect.height > 0.995
                    model.update { $0.crop = full ? nil : rect }
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 720)
        .task {
            rect = model.edit.crop ?? CGRect(x: 0, y: 0, width: 1, height: 1)
            await loadStill()
        }
    }

    private var screenAspect: CGFloat {
        CGFloat(model.project.screen.pixelWidth) / CGFloat(max(model.project.screen.pixelHeight, 1))
    }

    private func fit(_ size: CGSize) -> CGSize {
        let w = min(size.width, size.height * screenAspect)
        return CGSize(width: w, height: w / screenAspect)
    }

    private func cropOverlay(_ box: CGSize) -> some View {
        let r = CGRect(x: rect.minX * box.width, y: rect.minY * box.height, width: rect.width * box.width, height: rect.height * box.height)
        return ZStack(alignment: .topLeading) {
            // Dim outside the crop.
            Canvas { context, size in
                var path = Path(CGRect(origin: .zero, size: size))
                path.addRect(r)
                context.fill(path, with: .color(.black.opacity(0.5)), style: FillStyle(eoFill: true))
            }
            .allowsHitTesting(false)
            Rectangle()
                .strokeBorder(UmiTheme.trim, lineWidth: 2)
                .background(Color.white.opacity(0.001))
                .frame(width: r.width, height: r.height)
                .offset(x: r.minX, y: r.minY)
                .gesture(DragGesture(coordinateSpace: .named("crop")).onChanged { v in
                    let o = origin()
                    var moved = o.offsetBy(dx: v.translation.width / box.width, dy: v.translation.height / box.height)
                    moved.origin.x = min(max(moved.minX, 0), 1 - moved.width)
                    moved.origin.y = min(max(moved.minY, 0), 1 - moved.height)
                    rect = moved
                }.onEnded { _ in dragOrigin = nil })
            ForEach(0..<4, id: \.self) { corner in
                handle(corner, box: box, r: r)
            }
        }
        .coordinateSpace(.named("crop"))
    }

    /// Corner handles: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
    private func handle(_ corner: Int, box: CGSize, r: CGRect) -> some View {
        let x = corner % 2 == 0 ? r.minX : r.maxX
        let y = corner < 2 ? r.minY : r.maxY
        return RoundedRectangle(cornerRadius: 3)
            .fill(UmiTheme.trim)
            .frame(width: 14, height: 14)
            .position(x: x, y: y)
            .gesture(DragGesture(coordinateSpace: .named("crop")).onChanged { v in
                let o = origin()
                let px = min(max(v.location.x / box.width, 0), 1), py = min(max(v.location.y / box.height, 0), 1)
                var minX = o.minX, minY = o.minY, maxX = o.maxX, maxY = o.maxY
                if corner % 2 == 0 { minX = min(px, maxX - 0.05) } else { maxX = max(px, minX + 0.05) }
                if corner < 2 { minY = min(py, maxY - 0.05) } else { maxY = max(py, minY + 0.05) }
                rect = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
                applyLock(anchor: corner)
            }.onEnded { _ in dragOrigin = nil })
    }

    private func origin() -> CGRect {
        if let dragOrigin { return dragOrigin }
        dragOrigin = rect
        return rect
    }

    /// Adjusts the height to the locked ratio (in pixels), keeping the anchored corner.
    private func applyLock(anchor: Int = 3) {
        guard let lock else { return }
        let height = rect.width * screenAspect / lock
        var r = rect
        r.size.height = min(height, 1)
        if r.height == 1 { r.size.width = lock / screenAspect }
        if anchor < 2 { r.origin.y = rect.maxY - r.height }
        r.origin.x = min(max(r.minX, 0), 1 - r.width)
        r.origin.y = min(max(r.minY, 0), 1 - r.height)
        rect = r
    }

    private func loadStill() async {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: model.bundle.appendingPathComponent(RecordingProject.screenFile)))
        generator.maximumSize = CGSize(width: 1400, height: 1400)
        let t = model.sourceTime(for: model.currentTime) ?? 0
        if let (image, _) = try? await generator.image(at: CMTime(seconds: max(t, 0.5), preferredTimescale: 600)) {
            still = NSImage(cgImage: image, size: .zero)
        }
    }
}
