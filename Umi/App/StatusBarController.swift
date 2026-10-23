import AppKit
import Observation
import SwiftUI

/// App-wide objects shared by the status item and the SwiftUI scenes.
@MainActor
final class AppModel {
    static let shared = AppModel()

    let recorder = RecordingController()
    let library = RecordingsLibrary()
    /// SwiftUI's openWindow, captured from a view so AppKit code can open scenes.
    var openWindow: OpenWindowAction?
    var closeLauncher: () -> Void = {}

    func openLibrary() {
        openWindow?(id: WindowID.library)
        NSApp.activate()
    }

    func openEditor(_ bundle: URL) {
        library.reload(selecting: bundle)
        openWindow?(id: WindowID.editor, value: bundle)
        NSApp.activate()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusBar: StatusBarController?
    private var bridgeWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installOpenWindowBridge()
        statusBar = StatusBarController(model: .shared)
        observeFinishedRecordings()
    }

    /// `openWindow` only exists inside SwiftUI views, so keep one tiny invisible view
    /// alive that hands it to `AppModel`.
    private func installOpenWindowBridge() {
        let window = NSWindow(contentRect: CGRect(x: -10_000, y: -10_000, width: 1, height: 1), styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.collectionBehavior = [.transient, .ignoresCycle, .canJoinAllSpaces]
        window.contentView = NSHostingView(rootView: OpenWindowBridge())
        window.orderFrontRegardless()
        bridgeWindow = window
    }

    /// When a recording is saved, open it in the editor.
    private func observeFinishedRecordings() {
        let model = AppModel.shared
        withObservationTracking {
            _ = model.recorder.lastFinishedURL
        } onChange: {
            Task { @MainActor [weak self] in
                if let url = model.recorder.lastFinishedURL { model.openEditor(url) }
                self?.observeFinishedRecordings()
            }
        }
    }
}

private struct OpenWindowBridge: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .onAppear {
                AppModel.shared.openWindow = openWindow
                #if DEBUG
                // Dev hook: UMI_OPEN_EDITOR=/path/to/Some.umi opens that project on launch.
                if let path = ProcessInfo.processInfo.environment["UMI_OPEN_EDITOR"] {
                    AppModel.shared.openEditor(URL(fileURLWithPath: path))
                }
                #endif
            }
    }
}

/// The menu bar item: left click opens the launcher, right click shows a menu.
final class StatusBarController: NSObject, NSPopoverDelegate {
    private let model: AppModel
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private var titleTimer: Timer?

    init(model: AppModel) {
        self.model = model
        super.init()

        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
        popover.contentViewController = NSHostingController(rootView: MenuBarView()
            .environment(model.recorder)
            .environment(model.library))

        if let button = item.button {
            button.target = self
            button.action = #selector(clicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.imagePosition = .imageLeading
        }
        model.closeLauncher = { [weak self] in self?.popover.performClose(nil) }
        updateButton()
        observePhase()
    }

    @objc private func clicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            showMenu()
        } else {
            togglePopover()
        }
    }

    private func togglePopover() {
        guard let button = item.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
            NSApp.activate()
        }
    }

    private func showMenu() {
        popover.performClose(nil)
        let menu = NSMenu()
        let recorder = model.recorder
        switch recorder.phase {
        case .idle:
            menu.addItem(withTitle: "Start Recording", action: #selector(startStop), keyEquivalent: "").target = self
        case .recording, .paused:
            menu.addItem(withTitle: "Stop Recording", action: #selector(startStop), keyEquivalent: "").target = self
            menu.addItem(withTitle: recorder.phase == .paused ? "Resume" : "Pause", action: #selector(pauseResume), keyEquivalent: "").target = self
            menu.addItem(withTitle: "Discard Recording", action: #selector(discard), keyEquivalent: "").target = self
        case .countingDown, .finishing:
            break
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Library", action: #selector(openLibrary), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Umi", action: #selector(quit), keyEquivalent: "q").target = self

        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil // so the next left click opens the launcher again
    }

    @objc private func startStop() {
        switch model.recorder.phase {
        case .idle: model.recorder.start()
        case .recording, .paused: model.recorder.stop()
        default: break
        }
    }

    @objc private func pauseResume() {
        if model.recorder.phase == .paused { model.recorder.resume() } else { model.recorder.pause() }
    }

    @objc private func discard() { model.recorder.cancel() }
    @objc private func openLibrary() { model.openLibrary() }
    @objc private func quit() { NSApp.terminate(nil) }

    // MARK: Button

    private func observePhase() {
        withObservationTracking {
            _ = model.recorder.phase
        } onChange: {
            Task { @MainActor [weak self] in
                self?.updateButton()
                self?.observePhase()
            }
        }
    }

    private func updateButton() {
        let phase = model.recorder.phase
        let symbol: String = switch phase {
        case .recording: "record.circle.fill"
        case .paused: "pause.circle.fill"
        default: "record.circle"
        }
        item.button?.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Umi")
        item.button?.contentTintColor = phase == .recording ? .systemRed : nil

        titleTimer?.invalidate()
        if phase == .recording || phase == .paused {
            if popover.isShown { popover.performClose(nil) }
            let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.updateTitle() }
            }
            RunLoop.main.add(timer, forMode: .common)
            titleTimer = timer
            updateTitle()
        } else {
            item.button?.title = ""
        }
    }

    private func updateTitle() {
        item.button?.title = " " + model.recorder.elapsed.formattedDuration
    }

    // MARK: NSPopoverDelegate

    func popoverDidClose(_ notification: Notification) {
        model.recorder.launcherDidClose()
    }
}
