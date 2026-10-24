import AppKit
import SwiftUI

/// A small window for changing the global shortcuts.
@MainActor
enum ShortcutsWindow {
    private static var window: NSWindow?

    static func show() {
        AppModel.shared.closeLauncher()
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 420, height: 320),
                              styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Keyboard Shortcuts"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: ShortcutsView())
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        self.window = window
    }
}

struct ShortcutsView: View {
    private let hotKeys = HotKeys.shared
    @State private var recording: HotKeys.Action?
    @State private var message: String?
    @State private var monitor: Any?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Keyboard Shortcuts").font(.title3.bold())
            Text("They work everywhere, even when Umi is in the background. Click one and press the new keys.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                ForEach(HotKeys.Action.allCases) { action in
                    row(action)
                    if action != HotKeys.Action.allCases.last { Divider() }
                }
            }
            .padding(.horizontal, 12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.secondary.opacity(0.08)))
            HStack {
                if let message {
                    Text(message).font(.caption).foregroundStyle(UmiTheme.record)
                }
                Spacer()
                Button("Restore Defaults") {
                    for action in HotKeys.Action.allCases { hotKeys.setShortcut(nil, for: action) }
                    message = nil
                }
            }
        }
        .padding(20)
        .frame(width: 420)
        .onDisappear { stopRecording() }
    }

    private func row(_ action: HotKeys.Action) -> some View {
        let listening = recording == action
        return HStack {
            Text(action.title)
            Spacer()
            if hotKeys.unavailable.contains(action), !listening {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .help("Another app already uses this shortcut. Pick a different one.")
            }
            Button { listening ? stopRecording() : startRecording(action) } label: {
                Text(listening ? "Type shortcut…" : hotKeys.shortcut(for: action).display)
                    .font(.system(size: 13, weight: .semibold).monospaced())
                    .frame(minWidth: 110)
                    .padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(listening ? UmiTheme.accent.opacity(0.15) : Color.secondary.opacity(0.12)))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(listening ? UmiTheme.accent : .clear, lineWidth: 1.5))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 9)
    }

    private func startRecording(_ action: HotKeys.Action) {
        stopRecording()
        recording = action
        message = nil
        hotKeys.suspend(true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 { // Escape
                stopRecording()
                return nil
            }
            guard let shortcut = Shortcut(event: event) else {
                message = "Use at least one of ⌘, ⌥ or ⌃."
                return nil
            }
            if let other = hotKeys.conflict(shortcut, excluding: action) {
                message = "\(shortcut.display) is already used for “\(other.title)”."
                return nil
            }
            stopRecording()
            hotKeys.setShortcut(shortcut, for: action)
            if hotKeys.unavailable.contains(action) { message = "\(shortcut.display) is taken by another app." }
            return nil
        }
    }

    private func stopRecording() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if recording != nil {
            recording = nil
            hotKeys.suspend(false)
        }
    }
}
