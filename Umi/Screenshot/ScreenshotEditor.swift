import AppKit
import SwiftUI

/// Opens screenshot editor windows (plain AppKit windows, one per capture).
@MainActor
enum ScreenshotEditor {
    private static var windows: [NSWindow] = []

    /// Pick an area, capture it, and open the editor.
    static func captureArea() {
        AppModel.shared.closeLauncher()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            AppModel.shared.areaSelector.pick(initial: nil) { rect in
                guard let rect else { return }
                Task {
                    // Let the selector fade before grabbing the screen.
                    try? await Task.sleep(for: .milliseconds(150))
                    do {
                        open(try await ScreenshotCapture.capture(rect))
                    } catch {
                        NSAlert(error: error).runModal()
                    }
                }
            }
        }
    }

    static func open(_ image: CGImage) {
        let document = ScreenshotDocument(image: image)
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 1180, height: 760),
                              styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Screenshot"
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: ScreenshotEditorView(document: document) { window.close() })
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        windows.append(window)
        let id = ObjectIdentifier(window)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { _ in
            MainActor.assumeIsolated { windows.removeAll { ObjectIdentifier($0) == id } }
        }
    }
}

struct ScreenshotEditorView: View {
    let document: ScreenshotDocument
    let close: () -> Void
    @State private var base: NSImage?
    @State private var draft: Annotation?
    @State private var savedURL: URL?
    @State private var copied = false

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                toolbar
                Divider()
                GeometryReader { geo in
                    let size = fit(document.canvasSize, in: CGSize(width: geo.size.width - 40, height: geo.size.height - 40))
                    ZStack {
                        if let base { Image(nsImage: base).resizable().frame(width: size.width, height: size.height) }
                        Canvas { context, canvasSize in
                            context.withCGContext { cg in
                                for a in document.annotations + (draft.map { [$0] } ?? []) {
                                    if a.kind == .blur {
                                        let r = CGRect(x: a.rect.minX * canvasSize.width, y: a.rect.minY * canvasSize.height,
                                                       width: a.rect.width * canvasSize.width, height: a.rect.height * canvasSize.height)
                                        cg.setStrokeColor(CGColor(gray: 1, alpha: 0.9)); cg.setLineWidth(1.5); cg.setLineDash(phase: 0, lengths: [5, 4])
                                        cg.stroke(r)
                                        cg.setLineDash(phase: 0, lengths: [])
                                    } else {
                                        AnnotationPainter.draw(a, in: cg, size: canvasSize)
                                    }
                                }
                            }
                        }
                        .frame(width: size.width, height: size.height)
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                            let a = CGPoint(x: v.startLocation.x / size.width, y: v.startLocation.y / size.height)
                            let b = CGPoint(x: v.location.x / size.width, y: v.location.y / size.height)
                            draft = Annotation(kind: document.tool, from: a, to: b, color: document.color)
                        }.onEnded { _ in
                            guard var d = draft else { return }
                            draft = nil
                            if d.kind != .text, hypot(d.to.x - d.from.x, d.to.y - d.from.y) < 0.01 { return }
                            if d.kind == .text { d.to = d.from }
                            document.annotations.append(d)
                            document.selected = d.id
                        })
                    }
                    .frame(width: geo.size.width, height: geo.size.height)
                }
                .background(Color(nsColor: .underPageBackgroundColor))
            }
            Divider()
            sidebar.frame(width: 290)
        }
        .task(id: renderKey) {
            base = document.renderBase(maxSide: 1600).map { NSImage(cgImage: $0, size: .zero) }
        }
    }

    /// Re-render the base when the look or the blur areas change.
    private var renderKey: Int {
        var hasher = Hasher()
        hasher.combine(document.style)
        for a in document.annotations where a.kind == .blur { hasher.combine(a) }
        return hasher.finalize()
    }

    private func fit(_ size: CGSize, in box: CGSize) -> CGSize {
        let s = min(box.width / max(size.width, 1), box.height / max(size.height, 1))
        return CGSize(width: size.width * s, height: size.height * s)
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            Picker("", selection: Binding(get: { document.tool }, set: { document.tool = $0 })) {
                ForEach(Annotation.Kind.allCases, id: \.self) { kind in
                    Image(systemName: kind.icon).tag(kind).help(kind.rawValue.capitalized)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Divider().frame(height: 18)
            ForEach(AnnotationColor.allCases, id: \.self) { color in
                Button { document.color = color } label: {
                    Circle().fill(Color(cgColor: color.cgColor)).frame(width: 18, height: 18)
                        .overlay(Circle().strokeBorder(document.color == color ? Color.primary : .primary.opacity(0.2), lineWidth: document.color == color ? 2 : 1))
                }
                .buttonStyle(.plain)
            }
            Spacer()
            Button {
                if !document.annotations.isEmpty { document.annotations.removeLast() }
            } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                .disabled(document.annotations.isEmpty)
                .keyboardShortcut("z", modifiers: .command)
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Look").font(.headline)
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(44), spacing: 8), count: 5), spacing: 8) {
                        ForEach(EditSettings.GradientPreset.pickable, id: \.self) { preset in
                            let (a, b) = preset.colors
                            Button { document.style.background = .gradient(preset) } label: {
                                RoundedRectangle(cornerRadius: 7)
                                    .fill(LinearGradient(colors: [a.color, b.color], startPoint: .topLeading, endPoint: .bottomTrailing))
                                    .frame(width: 44, height: 30)
                                    .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(document.style.background == .gradient(preset) ? UmiTheme.accent : .primary.opacity(0.12),
                                                                                             lineWidth: document.style.background == .gradient(preset) ? 2.5 : 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Picker("Frame", selection: Binding(get: { document.style.frame }, set: { document.style.frame = $0 })) {
                        ForEach(EditSettings.DeviceFrame.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    Picker("Aspect", selection: Binding(get: { document.style.aspect }, set: { document.style.aspect = $0 })) {
                        ForEach(EditSettings.AspectRatio.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    labeled("Padding", value: Binding(get: { document.style.padding }, set: { document.style.padding = $0 }), range: 0...0.4)
                    labeled("Corners", value: Binding(get: { document.style.cornerRadius }, set: { document.style.cornerRadius = $0 }), range: 0...0.08)
                    labeled("Shadow", value: Binding(get: { document.style.shadow }, set: { document.style.shadow = $0 }), range: 0...1)

                    if let id = document.selected, let i = document.annotations.firstIndex(where: { $0.id == id }), document.annotations[i].kind == .text {
                        Text("Text").font(.headline)
                        TextField("Text", text: Binding(get: { document.annotations[i].text }, set: { document.annotations[i].text = $0 }))
                            .textFieldStyle(.roundedBorder)
                    }
                    if !document.annotations.isEmpty {
                        Text("Annotations").font(.headline)
                        ForEach(document.annotations) { a in
                            HStack {
                                Image(systemName: a.kind.icon)
                                Text(a.kind == .text ? a.text : a.kind.rawValue.capitalized).lineLimit(1)
                                Spacer()
                                Button { document.annotations.removeAll { $0.id == a.id } } label: { Image(systemName: "trash") }
                                    .buttonStyle(.borderless)
                            }
                            .font(.callout)
                            .padding(.vertical, 2)
                            .contentShape(Rectangle())
                            .onTapGesture { document.selected = a.id }
                        }
                    }
                }
                .padding(16)
            }
            VStack(spacing: 8) {
                Button {
                    document.copyToClipboard()
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy to Clipboard", systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity)
                }
                .buttonStyle(InkButtonStyle(height: 40))
                .keyboardShortcut("c", modifiers: .command)
                HStack {
                    Button("Save PNG") { savedURL = try? document.save() }
                        .buttonStyle(GlassButtonStyle(height: 34, cornerRadius: 11, fullWidth: true))
                    if let savedURL {
                        Button("Finder") { NSWorkspace.shared.activateFileViewerSelecting([savedURL]) }
                            .buttonStyle(GlassButtonStyle(height: 34, cornerRadius: 11))
                        ShareLink(item: savedURL) { Image(systemName: "square.and.arrow.up") }
                            .buttonStyle(GlassButtonStyle(height: 34, cornerRadius: 11))
                    }
                }
            }
            .padding(16)
        }
    }

    private func labeled(_ title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.callout)
            Slider(value: value, in: range)
        }
    }
}
