import AppKit
import SwiftUI

/// Shows the first-run tour as floating callouts next to what each step is about:
/// the launcher, a demo of the recording control bar, and the camera bubble.
final class TourController {
    private enum Pointing { case right, left }

    private var callout: NSPanel?
    private var demoBar: NSPanel?
    private let recorder: RecordingController
    /// The launcher popover's window frame, or nil when it's closed.
    var launcherFrame: () -> CGRect? = { nil }

    init(recorder: RecordingController) {
        self.recorder = recorder
    }

    private var step: Int {
        get { UserDefaults.standard.integer(forKey: OnboardingStep.key) }
        set { UserDefaults.standard.set(newValue, forKey: OnboardingStep.key) }
    }

    var isActive: Bool { callout != nil }

    /// Frames of the tour's own windows, so clicks on them don't count as "outside".
    func contains(_ point: CGPoint) -> Bool {
        [callout, demoBar].contains { $0?.frame.contains(point) == true }
    }

    /// Starts on the first launcher open, or resumes where the user left off.
    func showIfNeeded() {
        if step == 0 { step = OnboardingStep.welcome.rawValue }
        if let current = OnboardingStep(rawValue: step) { show(current) }
    }

    func restart() {
        step = OnboardingStep.welcome.rawValue
        show(.welcome)
    }

    /// Hides the callouts but remembers the step (e.g. the launcher was closed).
    func suspend() {
        callout?.orderOut(nil)
        callout = nil
        demoBar?.orderOut(nil)
        demoBar = nil
    }

    private func finish() {
        step = OnboardingStep.done
        suspend()
    }

    private func advance() {
        guard let current = OnboardingStep(rawValue: step), let next = OnboardingStep(rawValue: current.rawValue + 1) else {
            finish()
            return
        }
        step = next.rawValue
        show(next)
    }

    // MARK: Layout

    private func show(_ step: OnboardingStep) {
        suspend()
        guard let launcher = launcherFrame() else { return }
        let screen = NSScreen.screens.first { $0.frame.intersects(launcher) }?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero

        switch step {
        case .welcome:
            place(step, pointing: .right, toward: CGPoint(x: launcher.minX, y: launcher.maxY - 140), screen: screen)
        case .settings:
            place(step, pointing: .right, toward: CGPoint(x: launcher.minX, y: launcher.midY + 20), screen: screen)
        case .ready:
            place(step, pointing: .right, toward: CGPoint(x: launcher.minX, y: launcher.minY + 70), screen: screen)
        case .controls:
            let bar = showDemoBar(on: screen)
            place(step, pointing: .left, toward: CGPoint(x: bar.maxX, y: bar.midY), screen: screen)
        case .bubble:
            if let bubble = recorder.cameraBubbleFrame {
                let roomOnRight = screen.maxX - bubble.maxX > 520
                place(step, pointing: roomOnRight ? .left : .right,
                      toward: CGPoint(x: roomOnRight ? bubble.maxX : bubble.minX, y: bubble.midY), screen: screen)
            } else {
                place(step, pointing: .right, toward: CGPoint(x: launcher.minX, y: launcher.midY), screen: screen)
            }
        }
    }

    /// Puts the card beside `target`, with the scribble arrow on the side facing it.
    private func place(_ step: OnboardingStep, pointing: Pointing, toward target: CGPoint, screen: CGRect) {
        let content = TourCallout(step: step, pointsRight: pointing == .right, next: { [weak self] in self?.advance() },
                                  close: { [weak self] in self?.finish() })
        let host = FirstMouseHostingView(rootView: content)
        let size = host.fittingSize
        var origin = CGPoint(
            x: pointing == .right ? target.x - size.width - 6 : target.x + 6,
            // The arrow's tip sits near the top of the callout.
            y: target.y - size.height + TourCallout.arrowTipFromTop
        )
        origin.x = min(max(origin.x, screen.minX + 8), screen.maxX - size.width - 8)
        origin.y = min(max(origin.y, screen.minY + 8), screen.maxY - size.height - 8)

        let panel = makePanel(frame: CGRect(origin: origin, size: size))
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.popUpMenu.rawValue + 1)
        host.frame = CGRect(origin: .zero, size: size)
        panel.contentView = host
        panel.orderFrontRegardless()
        callout = panel
    }

    /// A non-interactive copy of the recording control bar, glowing, where the real one appears.
    private func showDemoBar(on screen: CGRect) -> CGRect {
        let size = CGSize(width: 104, height: 308)
        let frame = CGRect(x: screen.minX, y: screen.midY - size.height / 2, width: size.width, height: size.height)
        let panel = makePanel(frame: frame)
        panel.level = .floating
        panel.ignoresMouseEvents = true
        let view = ControlBarView(recorder: recorder)
            .shadow(color: UmiTheme.accent.opacity(0.55), radius: 16)
            .frame(width: size.width, height: size.height)
        panel.contentView = NSHostingView(rootView: view)
        panel.orderFrontRegardless()
        demoBar = panel
        return CGRect(x: frame.minX + 20, y: frame.minY + 20, width: 64, height: 268)
    }

    private func makePanel(frame: CGRect) -> NSPanel {
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        return panel
    }
}

/// Card + arrow. The arrow sits at the top on the side the target is on.
struct TourCallout: View {
    let step: OnboardingStep
    let pointsRight: Bool
    let next: () -> Void
    let close: () -> Void

    static let arrowTipFromTop: CGFloat = 26

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if !pointsRight { arrow.scaleEffect(x: -1) }
            TourCard(step: step, next: next, close: close)
                .padding(.vertical, 30)
            if pointsRight { arrow }
        }
        .padding(.horizontal, 10)
    }

    private var arrow: some View {
        // Ink line with a white halo, readable on light and dark backgrounds.
        ZStack {
            ScribbleArrow().stroke(.white, style: StrokeStyle(lineWidth: 6.5, lineCap: .round, lineJoin: .round))
            ScribbleArrow().stroke(UmiTheme.ink, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
        }
        .shadow(color: .black.opacity(0.18), radius: 3, y: 1)
            .frame(width: 92, height: 74)
            .padding(.top, 2)
    }
}
