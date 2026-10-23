import SwiftUI

struct InspectorView: View {
    let model: EditorModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                backgroundSection
                frameSection
                cursorSection
                if model.project.camera != nil { cameraSection }
                zoomSection
            }
            .padding(16)
        }
        .background(.background)
    }

    // MARK: Sections

    private var backgroundSection: some View {
        InspectorSection("Background", systemImage: "paintpalette") {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(44), spacing: 8), count: 5), spacing: 8) {
                ForEach(EditSettings.GradientPreset.allCases, id: \.self) { preset in
                    let (a, b) = preset.colors
                    Swatch(fill: AnyShapeStyle(LinearGradient(colors: [a.color, b.color], startPoint: .topLeading, endPoint: .bottomTrailing)),
                           selected: model.edit.background == .gradient(preset)) {
                        model.update { $0.background = .gradient(preset) }
                    }
                    .help(preset.rawValue.capitalized)
                }
                ColorPicker("", selection: colorBinding, supportsOpacity: false)
                    .labelsHidden()
                    .frame(width: 44, height: 30)
                    .help("Solid color")
            }
        }
    }

    private var frameSection: some View {
        InspectorSection("Frame", systemImage: "rectangle.inset.filled") {
            SliderRow("Padding", value: binding(\.padding), range: 0...0.25, model: model)
            SliderRow("Corners", value: binding(\.cornerRadius), range: 0...0.08, model: model)
            SliderRow("Shadow", value: binding(\.shadow), range: 0...1, model: model)
        }
    }

    private var cursorSection: some View {
        InspectorSection("Cursor", systemImage: "cursorarrow") {
            Toggle("Show cursor", isOn: binding(\.cursor.visible))
            SliderRow("Size", value: binding(\.cursor.size), range: 0.5...3, model: model, format: "%.1f×")
            Picker("Smoothing", selection: binding(\.cursor.smoothing)) {
                ForEach(EditSettings.Smoothing.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            }
            Toggle("Click rings", isOn: binding(\.cursor.clickRings))
        }
    }

    private var cameraSection: some View {
        InspectorSection("Camera", systemImage: "person.crop.circle") {
            Toggle("Show camera", isOn: binding(\.camera.visible))
            Picker("Shape", selection: binding(\.camera.shape)) {
                ForEach(EditSettings.Camera.Shape.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            }
            .pickerStyle(.segmented)
            SliderRow("Size", value: binding(\.camera.size), range: 0.1...0.45, model: model)
            Toggle("Mirror", isOn: binding(\.camera.mirrored))
            HStack {
                Text("Position")
                Spacer()
                ForEach(CameraCorner.allCases, id: \.self) { corner in
                    Button {
                        model.update { $0.camera.position = corner.position }
                    } label: {
                        Image(systemName: corner.icon)
                    }
                    .buttonStyle(.borderless)
                    .help(corner.label)
                }
            }
        }
    }

    private var zoomSection: some View {
        InspectorSection("Zoom", systemImage: "plus.magnifyingglass") {
            Toggle("Auto zoom on clicks", isOn: binding(\.zoom.auto))
            SliderRow("Zoom level", value: binding(\.zoom.scale), range: 1.2...3, model: model, format: "%.1f×")
            Text("Double-click the zoom track or press Z to add a zoom. Select a zoom and press Delete to remove it.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Bindings

    private func binding<Value: Equatable>(_ keyPath: WritableKeyPath<EditSettings, Value>) -> Binding<Value> {
        Binding(
            get: { model.edit[keyPath: keyPath] },
            set: { value in model.update { $0[keyPath: keyPath] = value } }
        )
    }

    private var colorBinding: Binding<Color> {
        Binding(
            get: {
                if case .color(let c) = model.edit.background { return c.color }
                return .white
            },
            set: { color in
                let resolved = color.resolve(in: EnvironmentValues())
                model.update { $0.background = .color(RGBA(Double(resolved.red), Double(resolved.green), Double(resolved.blue))) }
            }
        )
    }
}

private enum CameraCorner: CaseIterable {
    case topLeft, topRight, bottomLeft, bottomRight

    var position: CGPoint {
        switch self {
        case .topLeft: CGPoint(x: 0.14, y: 0.2)
        case .topRight: CGPoint(x: 0.86, y: 0.2)
        case .bottomLeft: CGPoint(x: 0.14, y: 0.8)
        case .bottomRight: CGPoint(x: 0.86, y: 0.8)
        }
    }

    var icon: String {
        switch self {
        case .topLeft: "arrow.up.left.square"
        case .topRight: "arrow.up.right.square"
        case .bottomLeft: "arrow.down.left.square"
        case .bottomRight: "arrow.down.right.square"
        }
    }

    var label: String {
        switch self {
        case .topLeft: "Top left"
        case .topRight: "Top right"
        case .bottomLeft: "Bottom left"
        case .bottomRight: "Bottom right"
        }
    }
}

private struct InspectorSection<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    init(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage).font(.headline)
            content
        }
    }
}

private struct SliderRow: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let model: EditorModel
    var format = "%.0f%%"

    init(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, model: EditorModel, format: String = "%.0f%%") {
        self.title = title
        _value = value
        self.range = range
        self.model = model
        self.format = format
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: format, format.contains("%%") ? value / range.upperBound * 100 : value))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: $value, in: range) { editing in
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
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(selected ? Color.accentColor : .primary.opacity(0.15), lineWidth: selected ? 2.5 : 1))
        }
        .buttonStyle(.plain)
    }
}

extension RGBA {
    var color: Color { Color(red: r, green: g, blue: b, opacity: a) }
}
