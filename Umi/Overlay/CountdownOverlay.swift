import AppKit
import SwiftUI

/// Full-screen 3-2-1 countdown shown before recording starts.
final class CountdownOverlay {
    private var panel: NSPanel?
    private var cancelled = false

    /// Returns `false` if the countdown was dismissed before it finished.
    func run(seconds: Int) async -> Bool {
        cancelled = false
        let model = CountdownModel(value: seconds)
        show(model)
        defer { dismiss() }

        for value in stride(from: seconds, through: 1, by: -1) {
            model.value = value
            try? await Task.sleep(for: .seconds(1))
            if cancelled || Task.isCancelled { return false }
        }
        return true
    }

    func dismiss() {
        cancelled = true
        panel?.orderOut(nil)
        panel = nil
    }

    private func show(_ model: CountdownModel) {
        let frame = NSScreen.main?.frame ?? .zero
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .screenSaver
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = NSHostingView(rootView: CountdownView(model: model))
        panel.orderFrontRegardless()
        self.panel = panel
    }
}

@Observable
private final class CountdownModel {
    var value: Int
    init(value: Int) { self.value = value }
}

private struct CountdownView: View {
    let model: CountdownModel

    var body: some View {
        ZStack {
            Color.black.opacity(0.25)
            Text("\(model.value)")
                .font(.system(size: 120, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 220, height: 220)
                .background(.black.opacity(0.6), in: Circle())
                .contentTransition(.numericText(countsDown: true))
                .animation(.snappy, value: model.value)
        }
        .ignoresSafeArea()
    }
}
