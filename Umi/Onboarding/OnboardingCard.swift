import SwiftUI

/// The first-run tour shown at the top of the launcher. Step 0 = not started yet
/// (shows on first launch), `done` = finished or dismissed.
enum OnboardingStep: Int, CaseIterable {
    case welcome = 1, settings, controls, bubble, ready

    static let done = 99

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
            "Record your screen and camera, polish it in the editor, and share it. No time limit, free forever."
        case .settings:
            "Choose what you want to record and check that your camera and mic are on. The bar under the mic moves when it hears you."
        case .controls:
            "While recording, a control bar floats at the side of your screen: stop, pause, restart or discard. Shortcuts: \(HotKeys.Action.startStop.display) start/stop, \(HotKeys.Action.pauseResume.display) pause, \(HotKeys.Action.cancel.display) cancel."
        case .bubble:
            "Drag your camera bubble anywhere on the screen. You can still move, resize or hide it later in the editor."
        case .ready:
            "Click Start recording. When you stop, Umi opens the editor with auto zoom, a smooth cursor and a nice background already applied."
        }
    }
}

struct OnboardingCard: View {
    let step: OnboardingStep
    let next: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Text("\(step.emoji) \(step.title)")
                    .font(.system(size: 15, weight: .bold))
                Spacer()
                Button(action: close) { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
                    .help("Skip the tour")
            }
            Text(step.message)
                .font(.system(size: 13))
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                HStack(spacing: 5) {
                    ForEach(OnboardingStep.allCases, id: \.self) { s in
                        Capsule()
                            .fill(s.rawValue <= step.rawValue ? Color.umiAccent : Color.secondary.opacity(0.3))
                            .frame(width: 16, height: 4)
                    }
                }
                Spacer()
                Button(step == .ready ? "Close" : "Next", action: next)
                    .buttonStyle(.borderedProminent)
                    .tint(.umiAccent)
                    .controlSize(.small)
            }
        }
        .padding(14)
        .background(Color.umiAccent.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.umiAccent.opacity(0.35)))
    }
}
