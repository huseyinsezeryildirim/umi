import AppKit
import SwiftUI

/// The floating, draggable recording controls (stop, timer, pause, restart, discard).
/// Like all of Umi's windows it is left out of the screen capture.
final class ControlBarController {
    private var panel: NSPanel?

    func show(recorder: RecordingController) {
        guard panel == nil else { return }
        let size = CGSize(width: 64, height: 268)
        let screen = NSScreen.main?.visibleFrame ?? .zero
        let origin = CGPoint(x: screen.minX + 20, y: screen.midY - size.height / 2)
        let panel = NSPanel(contentRect: CGRect(origin: origin, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.contentView = FirstMouseHostingView(rootView: ControlBarView(recorder: recorder))
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func hide() {
        panel?.orderOut(nil)
        panel = nil
    }
}

struct ControlBarView: View {
    let recorder: RecordingController
    @State private var confirmDiscard = false

    var body: some View {
        VStack(spacing: 10) {
            ControlButton(systemImage: "stop.fill", help: "Stop and open the editor  \(HotKeys.Action.startStop.display)", style: .stop) {
                recorder.stop()
            }

            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Text(recorder.elapsed.formattedDuration)
                    .font(.system(size: 12.5, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.white.opacity(recorder.phase == .paused ? 0.55 : 0.95))
                    .contentTransition(.numericText())
            }
            .padding(.vertical, 2)

            Rectangle().fill(.white.opacity(0.12)).frame(width: 28, height: 1)

            if recorder.phase == .paused {
                ControlButton(systemImage: "play.fill", help: "Resume  \(HotKeys.Action.pauseResume.display)", style: .highlighted) { recorder.resume() }
            } else {
                ControlButton(systemImage: "pause.fill", help: "Pause  \(HotKeys.Action.pauseResume.display)") { recorder.pause() }
            }
            ControlButton(systemImage: "arrow.counterclockwise", help: "Restart") { recorder.restart() }
            ControlButton(systemImage: "trash", help: confirmDiscard ? "Click again to discard" : "Discard recording",
                          style: confirmDiscard ? .danger : .normal) {
                if confirmDiscard { recorder.cancel() } else { confirmDiscard = true }
            }
        }
        .padding(.vertical, 11)
        .frame(width: 60, height: 268)
        .umiGlass(in: Capsule(), tint: UmiTheme.night.opacity(0.72), dark: true)
        .overlay(Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.28), .white.opacity(0.06)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        .shadow(color: .black.opacity(0.3), radius: 14, y: 6)
        .environment(\.colorScheme, .dark)
        .overlay(alignment: .top) {
            if recorder.phase == .paused {
                Text("Paused")
                    .font(.system(size: 9.5, weight: .semibold))
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Capsule().fill(.white))
                    .foregroundStyle(UmiTheme.ink)
                    .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                    .offset(y: -9)
            }
        }
        .task(id: confirmDiscard) {
            guard confirmDiscard else { return }
            try? await Task.sleep(for: .seconds(3))
            confirmDiscard = false
        }
    }
}

private struct ControlButton: View {
    enum Style { case normal, stop, highlighted, danger }

    let systemImage: String
    let help: String
    var style = Style.normal
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Group {
                if style == .stop {
                    // A white disc with a red rounded square, the universal "stop recording".
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(UmiTheme.record)
                        .frame(width: 14, height: 14)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(.white))
                        .scaleEffect(hovering ? 1.05 : 1)
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(style == .danger ? UmiTheme.record : .white.opacity(hovering || style == .highlighted ? 1 : 0.8))
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(.white.opacity(style == .highlighted ? 0.22 : hovering ? 0.14 : 0)))
                }
            }
            .contentShape(Circle())
            .animation(.easeOut(duration: 0.12), value: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
    }
}
