import AVFoundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// The editor's right panel: settings for the selected timeline item on top, then tabs
/// for the whole video (canvas, cursor, camera, zoom, color, captions, audio).
struct InspectorView: View {
    let model: EditorModel
    @State private var tab = Tab.canvas

    enum Tab: String, CaseIterable {
        case canvas, cursor, camera, zoom, color, captions, audio

        var icon: String {
            switch self {
            case .canvas: "paintpalette"
            case .cursor: "cursorarrow"
            case .camera: "person.crop.circle"
            case .zoom: "plus.magnifyingglass"
            case .color: "camera.filters"
            case .captions: "captions.bubble"
            case .audio: "music.note"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if let selection = model.selection {
                SelectionPanel(model: model, selection: selection)
                    .padding(14)
                Divider()
            }
            HStack(spacing: 2) {
                ForEach(Tab.allCases, id: \.self) { t in
                    Button { tab = t } label: {
                        Image(systemName: t.icon)
                            .font(.system(size: 13, weight: .medium))
                            .frame(maxWidth: .infinity, minHeight: 28)
                            .background(RoundedRectangle(cornerRadius: 7).fill(tab == t ? UmiTheme.accent.opacity(0.15) : .clear))
                            .foregroundStyle(tab == t ? UmiTheme.accent : .secondary)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(t.rawValue.capitalized)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch tab {
                    case .canvas: CanvasSection(model: model)
                    case .cursor: CursorSection(model: model)
                    case .camera: CameraSection(model: model)
                    case .zoom: ZoomSection(model: model)
                    case .color: ColorSection(model: model)
                    case .captions: CaptionsSection(model: model)
                    case .audio: AudioSection(model: model)
                    }
                }
                .padding(16)
            }
        }
        .background(.background)
    }
}

// MARK: - Selection

private struct SelectionPanel: View {
    let model: EditorModel
    let selection: EditorSelection

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Button(role: .destructive) { model.deleteSelection() } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
                    .help("Delete (⌫)")
                Button { model.selection = nil } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
                    .help("Deselect")
            }
            content
        }
    }

    private var title: String {
        switch selection {
        case .clip(let i): "Clip \(i + 1)"
        case .zoom: "Zoom"
        case .mask: "Privacy mask"
        case .scene: "Scene"
        case .text: "Text"
        case .move: "3D move"
        case .music: "Music"
        case .overlay: "Media"
        }
    }

    @ViewBuilder
    private var content: some View {
        switch selection {
        case .clip(let index):
            if model.placements.indices.contains(index) {
                let speed = model.placements[index].clip.speed
                Picker("Speed", selection: Binding(get: { speed }, set: { model.setSpeed($0, forClip: index) })) {
                    ForEach([0.25, 0.5, 1, 1.5, 2, 4, 8], id: \.self) { Text(String(format: "%g×", $0)).tag($0) }
                }
                Hint("Drag a clip to reorder it. Drag its edges to trim. Press S to split at the playhead.")
            }
        case .zoom(let id):
            if let zoom = model.zoomSegments.first(where: { $0.id == id }) {
                Slider2("Zoom level", value: zoom.scale, range: EditSettings.ZoomSegment.scaleRange, format: "%.1f×", model: model) { v in
                    model.updateZoom(id) { $0.scale = v }
                }
                Picker("Focus", selection: Binding(get: { zoom.focus == nil }, set: { follow in
                    model.updateZoom(id) { $0.focus = follow ? nil : CGPoint(x: 0.5, y: 0.5) }
                })) {
                    Text("Follow cursor").tag(true)
                    Text("Fixed point").tag(false)
                }
                .pickerStyle(.segmented)
                if zoom.focus != nil { Hint("Click on the preview to set the focal point.") }
            }
        case .mask(let id):
            if let mask = model.edit.masks.first(where: { $0.id == id }) {
                Picker("Style", selection: Binding(get: { mask.style }, set: { s in model.updateMask(id) { $0.style = s } })) {
                    ForEach(EditSettings.PrivacyMask.Style.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
                Slider2(mask.style == .highlight ? "Dimming" : "Strength", value: mask.amount, range: 0...1, format: "%.0f%%", percent: true, model: model) { v in
                    model.updateMask(id) { $0.amount = v }
                }
                Hint("Drag the box on the preview to cover what's private; drag its corner to resize.")
            }
        case .scene(let id):
            if let scene = model.edit.scenes.first(where: { $0.id == id }) {
                Picker("Layout", selection: Binding(get: { scene.layout }, set: { l in model.updateScene(id) { $0.layout = l } })) {
                    ForEach(EditSettings.SceneLayout.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Slider2("Transition", value: scene.transition, range: 0...1.2, format: "%.1fs", model: model) { v in
                    model.updateScene(id) { $0.transition = v }
                }
            }
        case .text(let id):
            if let text = model.edit.texts.first(where: { $0.id == id }) {
                Picker("Style", selection: Binding(get: { text.style }, set: { s in model.updateText(id) { $0.style = s } })) {
                    ForEach(EditSettings.TextStyle.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                TextField("Text", text: Binding(get: { text.text }, set: { t in model.updateText(id) { $0.text = t } }))
                if [.lowerThird, .bigStat, .quote].contains(text.style) {
                    TextField(text.style == .quote ? "Author" : text.style == .bigStat ? "Caption" : "Role", text: Binding(get: { text.detail }, set: { t in model.updateText(id) { $0.detail = t } }))
                }
                Picker("Animation", selection: Binding(get: { text.animation }, set: { a in model.updateText(id) { $0.animation = a } })) {
                    ForEach(EditSettings.TextAnimation.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
                Hint("Drag the dot on the preview to place the text.")
            }
        case .overlay(let id):
            if let overlay = model.edit.overlays.first(where: { $0.id == id }) {
                Label(overlay.file, systemImage: overlay.kind == .video ? "film" : "photo").lineLimit(1).truncationMode(.middle)
                Picker("Show as", selection: Binding(get: { overlay.mode }, set: { m in model.updateOverlay(id) { $0.mode = m } })) {
                    Text("Fill screen").tag(EditSettings.MediaOverlay.Mode.fill)
                    Text("Picture in picture").tag(EditSettings.MediaOverlay.Mode.pictureInPicture)
                }
                .pickerStyle(.segmented)
                if overlay.mode == .pictureInPicture {
                    Slider2("Size", value: overlay.width, range: 0.15...0.8, format: "%.0f%%", percent: true, model: model) { v in
                        model.updateOverlay(id) { $0.width = v }
                    }
                    HStack {
                        Text("Position")
                        Spacer()
                        ForEach([(CGPoint(x: 0.25, y: 0.28), "arrow.up.left.square"), (CGPoint(x: 0.75, y: 0.28), "arrow.up.right.square"),
                                 (CGPoint(x: 0.5, y: 0.5), "square.dashed"),
                                 (CGPoint(x: 0.25, y: 0.72), "arrow.down.left.square"), (CGPoint(x: 0.75, y: 0.72), "arrow.down.right.square")], id: \.1) { center, icon in
                            Button { model.updateOverlay(id) { $0.center = center } } label: { Image(systemName: icon) }
                                .buttonStyle(.borderless)
                        }
                    }
                }
                Hint("Drag it along the Media track to move it, or its yellow edges to trim. It stays in place when you cut the video under it.")
            }
        case .music:
            if let music = model.edit.music {
                Label(music.file, systemImage: "waveform").lineLimit(1).truncationMode(.middle)
                Slider2("Volume", value: music.volume, range: 0...1, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.music?.volume = v } }
                Slider2("Fade out", value: music.fadeOut, range: 0...6, format: "%.1fs", model: model) { v in model.update { $0.music?.fadeOut = v } }
                Button("Replace…") { model.chooseMusic() }
                Hint("Music loops to the length of the video and plays under your voice.")
            }
        case .move(let id):
            if let move = model.edit.moves.first(where: { $0.id == id }) {
                Picker("Move", selection: Binding(get: { move.kind }, set: { k in model.updateMove(id) { $0.kind = k } })) {
                    ForEach(EditSettings.MoveKind.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
            }
        }
    }
}

// MARK: - Canvas

private struct CanvasSection: View {
    let model: EditorModel
    @State private var kind = Kind.gradient
    @State private var wallpapers: [URL] = []

    enum Kind: String, CaseIterable { case gradient = "Gradient", color = "Color", wallpaper = "Wallpaper", image = "Image" }

    var body: some View {
        Section2("Background", icon: "paintpalette") {
            Picker("", selection: $kind) {
                ForEach(Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            switch kind {
            case .gradient:
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(44), spacing: 8), count: 5), spacing: 8) {
                    ForEach(EditSettings.GradientPreset.pickable, id: \.self) { preset in
                        let (a, b) = preset.colors
                        Swatch(fill: AnyShapeStyle(LinearGradient(colors: [a.color, b.color], startPoint: .topLeading, endPoint: .bottomTrailing)),
                               selected: model.edit.background == .gradient(preset)) { model.update { $0.background = .gradient(preset) } }
                            .help(preset.rawValue.capitalized)
                    }
                }
                Slider2("Angle", value: model.edit.backgroundAngle, range: 0...360, format: "%.0f°", model: model) { v in model.update { $0.backgroundAngle = v } }
                Button("Randomize") {
                    model.update {
                        $0.background = .gradient(EditSettings.GradientPreset.pickable.randomElement()!)
                        $0.backgroundAngle = Double(Int.random(in: 0..<12) * 30)
                    }
                }
            case .color:
                ColorPicker("Color", selection: colorBinding, supportsOpacity: false)
            case .wallpaper:
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(wallpapers, id: \.self) { url in
                        WallpaperThumb(url: url, selected: model.edit.background == .image(url.path)) { model.setBackgroundImage(url) }
                    }
                }
                .task { wallpapers = await Wallpapers.list() }
            case .image:
                Button("Choose Image…") {
                    let panel = NSOpenPanel()
                    panel.allowedContentTypes = [.image]
                    if panel.runModal() == .OK, let url = panel.url { model.setBackgroundImage(url) }
                }
            }
            Slider2("Noise", value: model.edit.backgroundNoise, range: 0...1, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.backgroundNoise = v } }
        }
        .onAppear {
            switch model.edit.background {
            case .gradient: kind = .gradient
            case .color: kind = .color
            case .image(let path): kind = path.hasPrefix("/System") ? .wallpaper : .image
            }
        }

        Section2("Frame", icon: "macwindow") {
            Picker("Device", selection: Binding(get: { model.edit.frame }, set: { f in model.update { $0.frame = f } })) {
                ForEach(EditSettings.DeviceFrame.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Slider2("Padding", value: model.edit.padding, range: 0...0.4, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.padding = v } }
            Slider2("Corners", value: model.edit.cornerRadius, range: 0...0.08, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.cornerRadius = v } }
            Slider2("Shadow", value: model.edit.shadow, range: 0...1, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.shadow = v } }
            Slider2("Border", value: model.edit.border, range: 0...0.02, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.border = v } }
        }
    }

    private var colorBinding: Binding<Color> {
        Binding(
            get: { if case .color(let c) = model.edit.background { return c.color } else { return .white } },
            set: { color in
                let r = color.resolve(in: EnvironmentValues())
                model.update { $0.background = .color(RGBA(Double(r.red), Double(r.green), Double(r.blue))) }
            }
        )
    }
}

/// The Mac's own wallpapers, usable as backgrounds without copying them.
private enum Wallpapers {
    static func list() async -> [URL] {
        let folder = URL(fileURLWithPath: "/System/Library/Desktop Pictures")
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { ["heic", "jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
}

private struct WallpaperThumb: View {
    let url: URL
    let selected: Bool
    let action: () -> Void
    @State private var image: NSImage?

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 7).fill(.quaternary)
                if let image { Image(nsImage: image).resizable().aspectRatio(contentMode: .fill) }
            }
            .frame(height: 50)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(selected ? UmiTheme.accent : .primary.opacity(0.12), lineWidth: selected ? 2.5 : 1))
        }
        .buttonStyle(.plain)
        .help(url.deletingPathExtension().lastPathComponent)
        .task(id: url) {
            let url = url
            image = await Task.detached {
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                      let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                                                                kCGImageSourceThumbnailMaxPixelSize: 220] as CFDictionary)
                else { return nil as NSImage? }
                return NSImage(cgImage: cg, size: .zero)
            }.value
        }
    }
}

// MARK: - Cursor, camera, zoom

private struct CursorSection: View {
    let model: EditorModel

    var body: some View {
        Section2("Cursor", icon: "cursorarrow") {
            Toggle("Show cursor", isOn: bind(\.cursor.visible))
            Slider2("Size", value: model.edit.cursor.size, range: 0.5...3, format: "%.1f×", model: model) { v in model.update { $0.cursor.size = v } }
            Picker("Smoothing", selection: bind(\.cursor.smoothing)) {
                ForEach(EditSettings.Smoothing.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            }
            Toggle("Click rings", isOn: bind(\.cursor.clickRings))
        }
    }

    private func bind<V: Equatable>(_ kp: WritableKeyPath<EditSettings, V>) -> Binding<V> {
        Binding(get: { model.edit[keyPath: kp] }, set: { v in model.update { $0[keyPath: kp] = v } })
    }
}

private struct CameraSection: View {
    let model: EditorModel

    var body: some View {
        Section2("Camera", icon: "person.crop.circle") {
            if model.project.camera == nil {
                Hint("This recording has no camera.")
            } else {
                Toggle("Show camera", isOn: Binding(get: { model.edit.camera.visible }, set: { v in model.update { $0.camera.visible = v } }))
                Picker("Shape", selection: Binding(get: { model.edit.camera.shape }, set: { v in model.update { $0.camera.shape = v } })) {
                    ForEach(EditSettings.Camera.Shape.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
                Slider2("Size", value: model.edit.camera.size, range: 0.1...0.45, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.camera.size = v } }
                Toggle("Mirror", isOn: Binding(get: { model.edit.camera.mirrored }, set: { v in model.update { $0.camera.mirrored = v } }))
                HStack {
                    Text("Position")
                    Spacer()
                    ForEach([(CGPoint(x: 0.14, y: 0.2), "arrow.up.left.square"), (CGPoint(x: 0.86, y: 0.2), "arrow.up.right.square"),
                             (CGPoint(x: 0.14, y: 0.8), "arrow.down.left.square"), (CGPoint(x: 0.86, y: 0.8), "arrow.down.right.square")], id: \.1) { position, icon in
                        Button { model.update { $0.camera.position = position } } label: { Image(systemName: icon) }
                            .buttonStyle(.borderless)
                    }
                }
                Hint("Use the Scenes track to switch to camera only, split screen or floating for part of the video.")
            }
        }
    }
}

private struct ZoomSection: View {
    let model: EditorModel

    var body: some View {
        Section2("Zoom", icon: "plus.magnifyingglass") {
            Toggle("Auto zoom on clicks", isOn: Binding(get: { model.edit.zoom.auto }, set: { v in model.update { $0.zoom.auto = v } }))
            Slider2("Default level", value: model.edit.zoom.scale, range: 1.2...4.5, format: "%.1f×", model: model) { v in model.update { $0.zoom.scale = v } }
            Hint("Press Z or use + on the Zoom track to add one. Select a zoom to change its level or fix its focal point.")
        }
    }
}

// MARK: - Color

private struct ColorSection: View {
    let model: EditorModel

    var body: some View {
        Section2("Color grade", icon: "camera.filters") {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 10) {
                ForEach(EditSettings.GradePreset.allCases, id: \.self) { preset in
                    Button { model.update { $0.grade.preset = preset } } label: {
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 7)
                                .fill(LinearGradient(colors: GradeSwatch.colors(preset), startPoint: .topLeading, endPoint: .bottomTrailing))
                                .frame(height: 34)
                                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(model.edit.grade.preset == preset ? UmiTheme.accent : .primary.opacity(0.12),
                                                                                         lineWidth: model.edit.grade.preset == preset ? 2.5 : 1))
                            Text(preset.rawValue.capitalized).font(.system(size: 11))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            Slider2("Exposure", value: model.edit.grade.exposure, range: -1...1, format: "%+.2f", model: model) { v in model.update { $0.grade.exposure = v } }
            Slider2("Contrast", value: model.edit.grade.contrast, range: -1...1, format: "%+.2f", model: model) { v in model.update { $0.grade.contrast = v } }
            Slider2("Saturation", value: model.edit.grade.saturation, range: -1...1, format: "%+.2f", model: model) { v in model.update { $0.grade.saturation = v } }
            Slider2("Vignette", value: model.edit.grade.vignette, range: 0...1, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.grade.vignette = v } }
            Slider2("Grain", value: model.edit.grade.grain, range: 0...1, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.grade.grain = v } }
        }
    }
}

private enum GradeSwatch {
    static func colors(_ preset: EditSettings.GradePreset) -> [Color] {
        switch preset {
        case .none: [Color(hex: 0xF4A261), Color(hex: 0x6D5AE6)]
        case .cinematic: [Color(hex: 0xC78A5A), Color(hex: 0x2F5D6E)]
        case .noir: [Color(hex: 0xD9D9D9), Color(hex: 0x1C1C1C)]
        case .vintage: [Color(hex: 0xE3C9A0), Color(hex: 0x8C6E52)]
        case .frost: [Color(hex: 0xD8EBFA), Color(hex: 0x6E8FB5)]
        case .golden: [Color(hex: 0xFFD27A), Color(hex: 0xD9733B)]
        case .midnight: [Color(hex: 0x3D4E8A), Color(hex: 0x0C1026)]
        case .vivid: [Color(hex: 0xFF5E7E), Color(hex: 0x3D7BFF)]
        case .dreamy: [Color(hex: 0xF7C6E0), Color(hex: 0xA99BF5)]
        }
    }
}

// MARK: - Captions

private struct CaptionsSection: View {
    let model: EditorModel
    @State private var localeID = Locale.current.identifier
    @State private var locales: [Locale] = []

    var body: some View {
        Section2("Captions", icon: "captions.bubble") {
            Picker("Language", selection: $localeID) {
                ForEach(locales, id: \.identifier) { locale in
                    Text(Locale.current.localizedString(forIdentifier: locale.identifier) ?? locale.identifier).tag(locale.identifier)
                }
            }
            if let status = model.captionProgress {
                ProgressView(status).controlSize(.small)
            } else {
                Button(model.edit.captions.words.isEmpty ? "Generate Captions" : "Regenerate Captions") {
                    model.generateCaptions(locale: Locale(identifier: localeID))
                }
                .buttonStyle(.borderedProminent)
                .tint(UmiTheme.accent)
            }
            Hint("Transcribed on this Mac. Your audio never leaves your computer.")

            if !model.edit.captions.words.isEmpty {
                Toggle("Show captions in video", isOn: bind(\.captions.enabled))
                Toggle("Highlight the spoken word", isOn: bind(\.captions.highlightActiveWord))
                Slider2("Size", value: model.edit.captions.size, range: 0.025...0.08, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.captions.size = v } }
                Slider2("Position", value: model.edit.captions.position, range: 0.1...0.95, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.captions.position = v } }
                HStack {
                    Button("Export SRT") { save(.srt) }
                    Button("Export VTT") { save(.vtt) }
                }
                Text("Lines").font(.subheadline.weight(.semibold)).padding(.top, 4)
                ForEach(Array(TextRenderer.lines(model.edit.captions.words).enumerated()), id: \.offset) { _, line in
                    CaptionLineField(model: model, line: line)
                }
            }
        }
        .task {
            locales = CaptionGenerator.onDeviceLocales
            if !locales.contains(where: { $0.identifier == localeID }) {
                localeID = locales.first { $0.identifier.hasPrefix(Locale.current.language.languageCode?.identifier ?? "en") }?.identifier
                    ?? locales.first?.identifier ?? "en-US"
            }
        }
    }

    private func bind<V: Equatable>(_ kp: WritableKeyPath<EditSettings, V>) -> Binding<V> {
        Binding(get: { model.edit[keyPath: kp] }, set: { v in model.update { $0[keyPath: kp] = v } })
    }

    private func save(_ format: SubtitleFormat) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = model.bundle.deletingPathExtension().lastPathComponent + "." + format.rawValue
        if panel.runModal() == .OK, let url = panel.url { model.exportSubtitles(format, to: url) }
    }
}

private struct CaptionLineField: View {
    let model: EditorModel
    let line: [EditSettings.CaptionWord]
    @State private var text = ""

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Button(line.first.map { $0.start.formattedPrecise } ?? "") {
                if let start = line.first?.start, let t = model.outputTime(for: start) { model.seek(to: t) }
            }
            .buttonStyle(.borderless)
            .font(.system(size: 10).monospacedDigit())
            TextField("", text: $text)
                .textFieldStyle(.roundedBorder)
                .onSubmit { model.editCaptionLine(line, text: text) }
        }
        .onAppear { text = line.map(\.text).joined(separator: " ") }
    }
}

// MARK: - Audio

private struct AudioSection: View {
    let model: EditorModel

    var body: some View {
        Section2("Clips", icon: "film") {
            Slider2("Crossfade", value: model.edit.crossfade, range: 0...1.5, format: "%.1fs", model: model) { v in model.update { $0.crossfade = v } }
            Hint("Blends each cut into the next clip. Select a clip on the timeline to change its speed.")
        }
        Section2("Music", icon: "music.note") {
            if let music = model.edit.music {
                Label(music.file, systemImage: "waveform").lineLimit(1).truncationMode(.middle)
                Slider2("Volume", value: music.volume, range: 0...1, format: "%.0f%%", percent: true, model: model) { v in model.update { $0.music?.volume = v } }
                Slider2("Fade out", value: music.fadeOut, range: 0...6, format: "%.1fs", model: model) { v in model.update { $0.music?.fadeOut = v } }
                Button("Remove Music", role: .destructive) { model.update { $0.music = nil } }
            } else {
                Button("Add Audio File…") { model.chooseMusic() }
                Hint("Music plays under your voice and loops to the length of the video.")
            }
        }
    }
}

// MARK: - Building blocks

private struct Section2<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: Content

    init(_ title: String, icon: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon).font(.headline)
            content
        }
    }
}

private struct Hint: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
}

/// A labelled slider whose whole drag is one undo step.
private struct Slider2: View {
    let title: String
    let value: Double
    let range: ClosedRange<Double>
    let format: String
    var percent = false
    let model: EditorModel
    let set: (Double) -> Void

    init(_ title: String, value: Double, range: ClosedRange<Double>, format: String, percent: Bool = false, model: EditorModel, set: @escaping (Double) -> Void) {
        self.title = title
        self.value = value
        self.range = range
        self.format = format
        self.percent = percent
        self.model = model
        self.set = set
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: format, percent ? (value - range.lowerBound) / (range.upperBound - range.lowerBound) * 100 : value))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: Binding(get: { value }, set: set), in: range) { editing in
                if editing { model.beginGesture() } else { model.endGesture() }
            }
        }
    }
}

private struct Swatch: View {
    let fill: AnyShapeStyle
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            RoundedRectangle(cornerRadius: 7)
                .fill(fill)
                .frame(width: 44, height: 30)
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(selected ? UmiTheme.accent : .primary.opacity(0.15), lineWidth: selected ? 2.5 : 1))
        }
        .buttonStyle(.plain)
    }
}

extension RGBA {
    var color: Color { Color(red: r, green: g, blue: b, opacity: a) }
}
