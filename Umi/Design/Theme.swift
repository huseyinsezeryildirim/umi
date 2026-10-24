import SwiftUI

/// Umi's design language: near-white surfaces, ink text, icy-blue light and white
/// "glass" controls (the same family as Umada and voiceos.com). Colours are sRGB.
enum UmiTheme {
    // Ink
    static let ink = Color(hex: 0x0E111E)
    static let body = Color(hex: 0x11121D)
    static let secondary = Color(hex: 0x4A4F58)
    static let tertiary = Color(hex: 0x686B74)

    // Light
    static let iceTop = Color(hex: 0xF1F7FC)
    static let iceBottom = Color(hex: 0xE1EFFC)
    static let track = Color(hex: 0xEFF0F4)
    static let ringLit = Color(hex: 0xC5D9F3)
    static let innerGlow = Color(hex: 0xD3E6FA)
    static let cardBorder = Color.black.opacity(0.05)
    static let hairline = Color.black.opacity(0.10)

    // Accent
    static let accent = Color(hex: 0x116FF5)
    static let accentLight = Color(hex: 0x6FB5EF)
    static let record = Color(hex: 0xF0443A)
    /// Selection and trim handles on the timeline (the yellow other editors use).
    static let trim = Color(hex: 0xFFC83D)

    // Dark glass (recording controls)
    static let night = Color(hex: 0x0E111E)
    static let navy = Color(hex: 0x1F3A63)

    /// Soft white-to-ice wash used behind panels.
    static let iceWash = LinearGradient(colors: [.white, iceTop, iceBottom], startPoint: .top, endPoint: .bottom)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
}

// MARK: Buttons

/// The white glass button: white face with a pale-blue inner glow, a 1 pt stroke lit
/// from the lower left and a small shadow. Settles to 98 % on hover and press.
struct GlassButtonStyle: ButtonStyle {
    var height: CGFloat = 44
    var cornerRadius: CGFloat = 14
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        GlassButtonBody(configuration: configuration, height: height, cornerRadius: cornerRadius, fullWidth: fullWidth)
    }
}

private struct GlassButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let height: CGFloat
    let cornerRadius: CGFloat
    let fullWidth: Bool
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(isEnabled ? Color(hex: 0x2B2B2B) : Color(hex: 0x959595))
            .padding(.horizontal, 20)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(height: height)
            .background {
                shape.fill(.white.shadow(.inner(color: isEnabled ? UmiTheme.innerGlow : Color(hex: 0xEEF2F8), radius: 4, x: -1.5, y: -1.5)))
                    .overlay {
                        LinearGradient(colors: [.white, .white.opacity(0)], startPoint: .top, endPoint: .center)
                            .mask(shape.inset(by: 2))
                            .opacity(hovering && isEnabled ? 0.9 : 0)
                    }
            }
            .overlay {
                shape.strokeBorder(LinearGradient(
                    colors: isEnabled ? [Color(hex: 0xB0B6C5), Color(hex: 0xD9E0EC)] : [Color(hex: 0xD3D8DD), Color(hex: 0xE8EDF2)],
                    startPoint: .topTrailing, endPoint: .bottomLeading), lineWidth: 1)
            }
            .shadow(color: .black.opacity(isEnabled ? 0.10 : 0.06), radius: 2, y: 1.5)
            .scaleEffect((hovering && isEnabled) || configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: hovering)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
            .contentShape(shape)
            .onHover { hovering = $0 }
    }
}

/// The ink capsule for the one main action on a surface (like voiceos.com's Download).
struct InkButtonStyle: ButtonStyle {
    var height: CGFloat = 48

    func makeBody(configuration: Configuration) -> some View {
        InkBody(configuration: configuration, height: height)
    }

    private struct InkBody: View {
        let configuration: ButtonStyleConfiguration
        let height: CGFloat
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.system(size: 15.5, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background(Capsule().fill(hovering ? Color(hex: 0x1D2130) : UmiTheme.ink))
                .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
                .shadow(color: UmiTheme.ink.opacity(0.25), radius: 8, y: 4)
                .scaleEffect(configuration.isPressed ? 0.98 : 1)
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
                .animation(.easeOut(duration: 0.12), value: hovering)
                .contentShape(Capsule())
                .onHover { hovering = $0 }
        }
    }
}

/// Small round white glass icon button (header actions).
struct GlassIconButtonStyle: ButtonStyle {
    var size: CGFloat = 30

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(UmiTheme.secondary)
            .frame(width: size, height: size)
            .background(Circle().fill(.white.shadow(.inner(color: UmiTheme.innerGlow, radius: 3, x: -1, y: -1))))
            .overlay(Circle().strokeBorder(LinearGradient(colors: [Color(hex: 0xC4CAD6), Color(hex: 0xE3E8F0)], startPoint: .topTrailing, endPoint: .bottomLeading)))
            .shadow(color: .black.opacity(0.06), radius: 1.5, y: 1)
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .contentShape(Circle())
    }
}

/// Plain grey text button that darkens on hover.
struct LinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        LinkBody(configuration: configuration)
    }

    private struct LinkBody: View {
        let configuration: ButtonStyleConfiguration
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.system(size: 13))
                .foregroundStyle(hovering || configuration.isPressed ? UmiTheme.body : UmiTheme.secondary)
                .contentShape(Rectangle())
                .onHover { hovering = $0 }
        }
    }
}

// MARK: Surfaces

/// White card. `.small`: rows (radius 16, 1 pt 5 % border, tiny shadow).
/// `.large`: callouts and panels (radius 24, hairline, big soft shadow).
struct UmiCard<Content: View>: View {
    enum Style { case small, large }
    var style: Style = .small
    var padding: CGFloat = 16
    var highlighted = false
    @ViewBuilder var content: Content

    init(_ style: Style = .small, padding: CGFloat = 16, highlighted: Bool = false, @ViewBuilder content: () -> Content) {
        self.style = style
        self.padding = padding
        self.highlighted = highlighted
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: style == .small ? 16 : 24, style: .continuous)
        content
            .padding(padding)
            .background(shape.fill(.white).shadow(color: .black.opacity(style == .small ? 0.04 : 0.10),
                                                  radius: style == .small ? 2 : 18, y: style == .small ? 1 : 8))
            .overlay(shape.strokeBorder(highlighted ? UmiTheme.ringLit : style == .small ? UmiTheme.cardBorder : UmiTheme.hairline,
                                        lineWidth: highlighted ? 2 : style == .small ? 1 : 0.5))
    }
}

/// A capsule switch like voiceos.com's privacy toggle: ink track with a white knob when on.
struct GlassSwitch: View {
    let isOn: Bool

    var body: some View {
        Capsule()
            .fill(isOn ? UmiTheme.ink : UmiTheme.track)
            .overlay(Capsule().strokeBorder(isOn ? .white.opacity(0.1) : UmiTheme.hairline, lineWidth: 0.5))
            .frame(width: 38, height: 22)
            .overlay(alignment: isOn ? .trailing : .leading) {
                Circle()
                    .fill(.white)
                    .shadow(color: .black.opacity(0.2), radius: 1.5, y: 1)
                    .padding(2.5)
            }
            .animation(.snappy(duration: 0.2), value: isOn)
    }
}

/// Umi's mark: the dot ring logo in ink.
struct UmiMark: View {
    var size: CGFloat = 28

    var body: some View {
        Image("Logo")
            .resizable()
            .renderingMode(.template)
            .aspectRatio(contentMode: .fit)
            .foregroundStyle(UmiTheme.ink)
            .frame(width: size, height: size)
    }
}

extension View {
    /// Liquid Glass on macOS 26, a tinted material before that.
    @ViewBuilder
    func umiGlass<S: Shape>(in shape: S, tint: Color? = nil, dark: Bool = false) -> some View {
        if #available(macOS 26.0, *) {
            self.glassEffect(tint.map { Glass.regular.tint($0) } ?? .regular, in: shape)
        } else {
            self.background(dark ? AnyShapeStyle(.ultraThickMaterial) : AnyShapeStyle(.ultraThinMaterial), in: shape)
                .background((tint ?? .clear).opacity(0.6), in: shape)
        }
    }
}

/// Hosting view for Umi's floating, never-key panels (control bar, tour callouts):
/// the first click goes straight to the button instead of only focusing the panel.
final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
