import AVFoundation
import SwiftUI

/// What the bubble looks like. Remembered between launches.
nonisolated struct CameraBubbleStyle: Codable, Hashable, Sendable {
    var shape = EditSettings.Camera.Shape.circle
    var diameter: CGFloat = Size.medium.diameter
    var mirrored = true
    /// Bubble center in global AppKit coordinates (bottom-left origin); nil = default spot.
    var center: CGPoint?

    enum Size: String, CaseIterable, Sendable {
        case small, medium, large

        var diameter: CGFloat {
            switch self {
            case .small: 140
            case .medium: 200
            case .large: 300
            }
        }

        /// Dot drawn for this preset in the bubble's controls.
        var dot: CGFloat {
            switch self {
            case .small: 6
            case .medium: 9
            case .large: 12
            }
        }
    }

    static let diameterRange: ClosedRange<CGFloat> = 120...480

    /// Corner radius for `diameter`, matching how the editor draws each shape.
    static func cornerRadius(for shape: EditSettings.Camera.Shape, diameter: CGFloat) -> CGFloat {
        switch shape {
        case .circle: diameter / 2
        case .squircle: diameter * 0.24
        case .square: diameter * 0.06
        }
    }

    private static let defaultsKey = "cameraBubble.style"

    static func load() -> CameraBubbleStyle {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              var style = try? JSONDecoder().decode(CameraBubbleStyle.self, from: data)
        else { return CameraBubbleStyle() }
        style.diameter = min(max(style.diameter, diameterRange.lowerBound), diameterRange.upperBound)
        return style
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: Self.defaultsKey)
    }
}

extension EditSettings.Camera.Shape {
    var bubbleIcon: String {
        switch self {
        case .circle: "circle"
        case .squircle: "app"
        case .square: "square"
        }
    }

    var next: Self {
        let all = Self.allCases
        return all[(all.firstIndex(of: self)! + 1) % all.count]
    }
}

@Observable
final class CameraBubbleModel {
    var style: CameraBubbleStyle
    var isHovering = false

    init(style: CameraBubbleStyle) {
        self.style = style
    }
}

/// Things the bubble's controls ask the controller to do (it owns the panel frame).
struct CameraBubbleActions {
    var setSize: (CameraBubbleStyle.Size) -> Void
    var setShape: (EditSettings.Camera.Shape) -> Void
    var toggleMirror: () -> Void
    var hide: () -> Void
    var drag: (_ ended: Bool) -> Void
    var resize: (_ ended: Bool) -> Void
}

/// The live camera preview plus Loom-style hover controls. The controls exist only in
/// this window; the camera track is recorded straight from the capture session.
struct CameraBubbleView: View {
    let session: AVCaptureSession
    let model: CameraBubbleModel
    let actions: CameraBubbleActions

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let radius = CameraBubbleStyle.cornerRadius(for: model.style.shape, diameter: side)
            let shape = RoundedRectangle(cornerRadius: radius, style: .circular)

            ZStack {
                CameraPreview(session: session, mirrored: model.style.mirrored)
                if model.isHovering {
                    controls(side: side)
                        .transition(.opacity)
                }
            }
            .frame(width: side, height: side)
            .clipShape(shape)
            .overlay(shape.strokeBorder(.white.opacity(0.9), lineWidth: 3))
            .overlay(alignment: .bottomTrailing) {
                if model.isHovering { resizeHandle(side: side, radius: radius) }
            }
            .contentShape(shape)
            .gesture(windowGesture(actions.drag))
            .animation(.spring(duration: 0.3), value: model.style.shape)
            .animation(.easeOut(duration: 0.15), value: model.isHovering)
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    /// Loom-style: a dark pill near the bottom with close | size dots, and a smaller pill
    /// near the top for shape and mirror.
    private func controls(side: CGFloat) -> some View {
        VStack {
            ControlPill {
                PillButton(help: "Shape: \(model.style.shape.rawValue.capitalized)") {
                    actions.setShape(model.style.shape.next)
                } label: {
                    Image(systemName: model.style.shape.bubbleIcon).font(.system(size: 11, weight: .semibold))
                }
                PillButton(help: model.style.mirrored ? "Mirrored" : "Not mirrored", selected: model.style.mirrored) {
                    actions.toggleMirror()
                } label: {
                    Image(systemName: "arrow.left.and.right").font(.system(size: 11, weight: .semibold))
                }
            }
            .padding(.top, side * 0.1)
            Spacer()
            ControlPill {
                PillButton(help: "Close camera") {
                    actions.hide()
                } label: {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold))
                }
                Rectangle().fill(.white.opacity(0.25)).frame(width: 1, height: 16)
                ForEach(CameraBubbleStyle.Size.allCases, id: \.self) { size in
                    PillButton(help: "\(size.rawValue.capitalized) size", selected: abs(model.style.diameter - size.diameter) < 1) {
                        actions.setSize(size)
                    } label: {
                        Circle().fill(.white).frame(width: size.dot, height: size.dot)
                    }
                }
            }
            .padding(.bottom, side * 0.1)
        }
    }

    /// Sits on the shape's edge at the bottom-right, so it's always over the camera.
    private func resizeHandle(side: CGFloat, radius: CGFloat) -> some View {
        // Distance from the bounding box corner to the shape edge along the diagonal.
        let inset = radius * (1 - 1 / sqrt(2)) + 2
        return Image(systemName: "arrow.up.left.and.arrow.down.right")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 22, height: 22)
            .background(.black.opacity(0.55), in: Circle())
            .overlay(Circle().strokeBorder(.white.opacity(0.8), lineWidth: 1))
            .contentShape(Circle())
            .offset(x: -inset, y: -inset)
            .gesture(windowGesture(actions.resize))
            .help("Drag to resize")
            .transition(.opacity)
    }

    /// Reports drags without coordinates; the controller reads the global mouse position,
    /// which stays stable while the window itself moves.
    private func windowGesture(_ handler: @escaping (Bool) -> Void) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { _ in handler(false) }
            .onEnded { _ in handler(true) }
    }
}

private struct ControlPill<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 2) { content }
            .padding(.horizontal, 4)
            .padding(.vertical, 3)
            .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.3), lineWidth: 1))
    }
}

private struct PillButton<Label: View>: View {
    let help: String
    var selected = false
    let action: () -> Void
    @ViewBuilder let label: Label

    var body: some View {
        Button(action: action) {
            label
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(selected ? AnyShapeStyle(.white.opacity(0.18)) : AnyShapeStyle(.clear), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

/// `AVCaptureVideoPreviewLayer` hosted in SwiftUI. Mirroring is the bubble's setting,
/// applied to the preview only (camera.mov is always unmirrored).
private struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession
    let mirrored: Bool

    func makeNSView(context: Context) -> PreviewView {
        PreviewView(session: session)
    }

    func updateNSView(_ view: PreviewView, context: Context) {
        view.mirrored = mirrored
    }

    final class PreviewView: NSView {
        private let preview: AVCaptureVideoPreviewLayer
        var mirrored = true {
            didSet { if mirrored != oldValue { applyMirroring() } }
        }

        init(session: AVCaptureSession) {
            preview = AVCaptureVideoPreviewLayer(session: session)
            super.init(frame: .zero)
            wantsLayer = true
            layer?.backgroundColor = NSColor.black.cgColor
            preview.videoGravity = .resizeAspectFill
            layer?.addSublayer(preview)
            // The preview connection only exists once the session has its input.
            NotificationCenter.default.addObserver(self, selector: #selector(sessionDidStart), name: AVCaptureSession.didStartRunningNotification, object: session)
            applyMirroring()
        }

        required init?(coder: NSCoder) { fatalError() }

        @objc private nonisolated func sessionDidStart() {
            Task { @MainActor in self.applyMirroring() }
        }

        override func layout() {
            super.layout()
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            preview.frame = bounds
            CATransaction.commit()
        }

        private func applyMirroring() {
            guard let connection = preview.connection, connection.isVideoMirroringSupported else { return }
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = mirrored
        }
    }
}
