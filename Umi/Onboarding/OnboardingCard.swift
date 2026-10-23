import SwiftUI

/// The first-run tour. Stored in UserDefaults as "onboardingStep":
/// 0 = not started yet (starts on first launcher open), `done` = finished or dismissed.
enum OnboardingStep: Int, CaseIterable {
    case welcome = 1, settings, controls, bubble, ready

    static let done = 99
    static let key = "onboardingStep"

    var emoji: String {
        switch self {
        case .welcome: "👋"
        case .settings: "👉"
        case .controls: "⏸️"
        case .bubble: "👈"
        case .ready: "🎬"
        }
    }

    var title: String {
        switch self {
        case .welcome: "Welcome to Umi"
        case .settings: "Check your settings"
        case .controls: "Learn the controls"
        case .bubble: "Position your camera bubble"
        case .ready: "You're ready to record"
        }
    }

    var message: String {
        switch self {
        case .welcome:
            "Record your screen and camera, polish it in the editor and share it. No time limit, free forever."
        case .settings:
            "Choose what you want to share and confirm that your mic and camera are on."
        case .controls:
            "While recording, pause freely to catch a breath, restart, or stop to open the editor. \(HotKeys.Action.startStop.display) starts and stops."
        case .bubble:
            "The window to your personality. Drag it anywhere on the screen, hover it to change size or shape."
        case .ready:
            "Walk someone through your work or give feedback. Be yourself, uhms and all. Umi adds the polish afterwards."
        }
    }
}

/// A tour callout: white card washed with icy blue at the bottom, ink title, grey
/// body, progress dashes and the white glass Next button. Always light.
struct TourCard: View {
    let step: OnboardingStep
    let next: () -> Void
    let close: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(step.emoji)  \(step.title)")
                    .font(.system(size: 19, weight: .semibold))
                    .tracking(-0.3)
                    .foregroundStyle(UmiTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                }
                .buttonStyle(GlassIconButtonStyle(size: 26))
                .help("Skip the tour")
            }
            Text(step.message)
                .font(.system(size: 14))
                .lineSpacing(3.3)
                .foregroundStyle(UmiTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .center) {
                HStack(spacing: 5) {
                    ForEach(OnboardingStep.allCases, id: \.self) { s in
                        Capsule()
                            .fill(s.rawValue <= step.rawValue ? UmiTheme.accent : UmiTheme.track)
                            .frame(width: s == step ? 22 : 14, height: 5)
                    }
                }
                .animation(.smooth(duration: 0.3), value: step)
                Spacer()
                Button(step == .ready ? "Done" : "Next", action: next)
                    .buttonStyle(GlassButtonStyle(height: 40, cornerRadius: 13))
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .frame(width: 360)
        .background(
            shape.fill(LinearGradient(colors: [.white, .white, UmiTheme.iceTop, UmiTheme.iceBottom], startPoint: .top, endPoint: .bottom))
                .shadow(color: .black.opacity(0.14), radius: 22, y: 10)
        )
        .overlay(shape.strokeBorder(UmiTheme.hairline, lineWidth: 0.5))
        .environment(\.colorScheme, .light)
    }
}

/// A hand-drawn arrow with a little loop, like a marker scribble. Drawn from the
/// bottom-left of its box to the top-right; flip it for other directions.
struct ScribbleArrow: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let start = CGPoint(x: r.minX + r.width * 0.06, y: r.maxY)
        let tip = CGPoint(x: r.maxX, y: r.minY + r.height * 0.32)
        p.move(to: start)
        // Rise, loop back over itself, then sweep out to the tip.
        p.addCurve(to: CGPoint(x: r.minX + r.width * 0.42, y: r.minY + r.height * 0.42),
                   control1: CGPoint(x: r.minX - r.width * 0.02, y: r.minY + r.height * 0.45),
                   control2: CGPoint(x: r.minX + r.width * 0.2, y: r.minY + r.height * 0.18))
        p.addCurve(to: CGPoint(x: r.minX + r.width * 0.36, y: r.minY + r.height * 0.6),
                   control1: CGPoint(x: r.minX + r.width * 0.55, y: r.minY + r.height * 0.6),
                   control2: CGPoint(x: r.minX + r.width * 0.42, y: r.minY + r.height * 0.72))
        p.addCurve(to: tip,
                   control1: CGPoint(x: r.minX + r.width * 0.3, y: r.minY + r.height * 0.45),
                   control2: CGPoint(x: r.minX + r.width * 0.55, y: r.minY + r.height * 0.05))
        // Arrowhead.
        p.move(to: CGPoint(x: tip.x - r.width * 0.16, y: tip.y - r.height * 0.14))
        p.addLine(to: tip)
        p.addLine(to: CGPoint(x: tip.x - r.width * 0.15, y: tip.y + r.height * 0.14))
        return p
    }
}
