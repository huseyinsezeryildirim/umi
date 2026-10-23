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
        panel.contentView = NSHostingView(rootView: ControlBarView(recorder: recorder))
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
        VStack(spacing: 14) {
            ControlButton(systemImage: "stop.fill", help: "Stop and open the editor  ⌥⇧L", tint: .red, prominent: true) {
                recorder.stop()
            }

            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Text(recorder.elapsed.formattedDuration)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
            }

            if recorder.phase == .paused {
                ControlButton(systemImage: "play.fill", help: "Resume  ⌥⇧P") { recorder.resume() }
            } else {
                ControlButton(systemImage: "pause.fill", help: "Pause  ⌥⇧P") { recorder.pause() }
            }
            ControlButton(systemImage: "arrow.counterclockwise", help: "Restart") { recorder.restart() }
            ControlButton(systemImage: "trash", help: confirmDiscard ? "Click again to discard" : "Discard recording", tint: confirmDiscard ? .red : nil) {
                if confirmDiscard { recorder.cancel() } else { confirmDiscard = true }
            }
        }
        .padding(.vertical, 12)
        .frame(width: 64, height: 268)
        .background(Color(white: 0.12).opacity(0.94), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
        .overlay(alignment: .top) {
            if recorder.phase == .paused {
                Text("Paused")
                    .font(.system(size: 9, weight: .bold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.orange, in: Capsule())
                    .foregroundStyle(.black)
                    .offset(y: -8)
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
    let systemImage: String
    let help: String
    var tint: Color?
    var prominent = false
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: prominent ? 17 : 16, weight: .semibold))
                .foregroundStyle(prominent ? .white : (tint ?? .white.opacity(0.85)))
                .frame(width: 42, height: 42)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(prominent ? (tint ?? .red) : .white.opacity(hovering ? 0.16 : 0))
                )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
    }
}
