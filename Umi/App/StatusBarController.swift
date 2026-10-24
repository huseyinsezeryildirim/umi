import AppKit
import Observation
import SwiftUI

/// App-wide objects shared by the status item and the SwiftUI scenes.
@MainActor
final class AppModel {
    static let shared = AppModel()

    let recorder = RecordingController()
    let library = RecordingsLibrary()
    let instantShare = InstantShareController()
    let areaSelector = AreaSelector()

    /// Closes the launcher, lets the user drag out an area, then reopens the launcher with it.
    func pickArea() {
        closeLauncher()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [self] in
            areaSelector.pick(initial: recorder.settings.areaRect) { [self] rect in
                if let rect {
                    recorder.settings.areaRect = rect
                    recorder.settings.mode = .area
                }
                recorder.onOpenLauncher()
            }
        }
    }
    /// SwiftUI's openWindow, captured from a view so AppKit code can open scenes.
    var openWindow: OpenWindowAction?
    var closeLauncher: () -> Void = {}
    var startTour: () -> Void = {}
    /// Closes the launcher but leaves the camera and bubble on (for macOS video effects).
    var closeLauncherKeepingCamera: () -> Void = {}

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
        observeWindows()
    }

    /// Clicking the Dock icon with no window open brings back the library.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { AppModel.shared.openLibrary() }
        return true
    }

    // MARK: Dock icon

    /// Umi lives in the menu bar, but while an editor or the library is open it also shows
    /// in the Dock and ⌘Tab, so those windows are easy to get back to.
    private func observeWindows() {
        let center = NotificationCenter.default
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didBecomeMainNotification, NSWindow.willCloseNotification] {
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                let closing = name == NSWindow.willCloseNotification ? note.object as? NSWindow : nil
                MainActor.assumeIsolated { self?.updateActivationPolicy(ignoring: closing) }
            }
        }
    }

    private func updateActivationPolicy(ignoring closing: NSWindow?) {
        let hasDocumentWindow = NSApp.windows.contains { window in
            window !== closing && window.isVisible && window.styleMask.contains(.titled) && !(window is NSPanel)
        }
        let policy: NSApplication.ActivationPolicy = hasDocumentWindow ? .regular : .accessory
        guard NSApp.activationPolicy() != policy else { return }
        NSApp.setActivationPolicy(policy)
        if hasDocumentWindow { NSApp.activate() }
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
                if let url = model.recorder.lastFinishedURL {
                    switch model.recorder.settings.flow {
                    case .instant: model.instantShare.run(bundle: url)
                    case .studio: model.openEditor(url)
                    }
                }
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
                    // Give SwiftUI's scenes a moment to come up before opening a window.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { AppModel.shared.openEditor(URL(fileURLWithPath: path)) }
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
    private let tour: TourController

    init(model: AppModel) {
        self.model = model
        tour = TourController(recorder: model.recorder)
        super.init()
        tour.launcherFrame = { [weak self] in
            guard let self, popover.isShown else { return nil }
            return popover.contentViewController?.view.window?.frame
        }

        // Closed by us (see `startDismissMonitors`), not by AppKit: the camera bubble and
        // tour callouts are separate windows, and clicks on them must not close the launcher.
        popover.behavior = .applicationDefined
        popover.appearance = NSAppearance(named: .aqua)
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
        model.startTour = { [weak self] in self?.tour.restart() }
        model.closeLauncherKeepingCamera = { [weak self] in
            self?.keepCameraOnClose = true
            self?.popover.performClose(nil)
        }
        model.recorder.onOpenLauncher = { [weak self] in self?.togglePopover() }
        updateButton()
        observePhase()
        #if DEBUG
        // UI-test hook: `cam.umi.debug.toggleLauncher` opens/closes the launcher, since the
        // status item can be hidden when the menu bar is full.
        DistributedNotificationCenter.default().addObserver(forName: .init("cam.umi.debug.toggleLauncher"), object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.togglePopover() }
        }
        #endif
    }

    @objc private func clicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            showMenu()
        } else {
            togglePopover()
        }
    }

    /// A tiny invisible window under the menu bar's right end, used to anchor the
    /// launcher when macOS has hidden the status item because the menu bar is full.
    private lazy var fallbackAnchor: NSWindow = {
        let window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.ignoresMouseEvents = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .transient]
        window.contentView = NSView()
        return window
    }()

    private func togglePopover() {
        guard let button = item.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            let visible = button.window.map { w in NSScreen.screens.contains { $0.frame.contains(CGPoint(x: w.frame.midX, y: w.frame.midY)) } } ?? false
            if visible {
                popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            } else {
                let screen = NSScreen.main ?? NSScreen.screens[0]
                let anchor = CGRect(x: screen.visibleFrame.maxX - 200, y: screen.visibleFrame.maxY - 2, width: 24, height: 2)
                fallbackAnchor.setFrame(anchor, display: false)
                fallbackAnchor.orderFrontRegardless()
                popover.show(relativeTo: fallbackAnchor.contentView!.bounds, of: fallbackAnchor.contentView!, preferredEdge: .minY)
            }
            popover.contentViewController?.view.window?.makeKey()
            startDismissMonitors()
            NSApp.activate()
            // Let the popover finish laying out before placing callouts next to it.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                guard let self, popover.isShown, model.recorder.phase == .idle else { return }
                tour.showIfNeeded()
            }
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
        model.library.reload()
        let recent = model.library.recordings.prefix(5)
        if !recent.isEmpty {
            let header = NSMenuItem(title: "Recent Recordings", action: nil, keyEquivalent: "")
            header.isEnabled = false
            menu.addItem(header)
            for recording in recent {
                let item = NSMenuItem(title: recording.title, action: #selector(openRecording(_:)), keyEquivalent: "")
                item.representedObject = recording.url
                item.target = self
                menu.addItem(item)
            }
            menu.addItem(.separator())
        }
        menu.addItem(withTitle: "Take Screenshot", action: #selector(takeScreenshot), keyEquivalent: "").target = self
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
    @objc private func takeScreenshot() { ScreenshotEditor.captureArea() }
    @objc private func openRecording(_ sender: NSMenuItem) {
        if let url = sender.representedObject as? URL { model.openEditor(url) }
    }
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

    private var keepCameraOnClose = false

    func popoverDidClose(_ notification: Notification) {
        stopDismissMonitors()
        fallbackAnchor.orderOut(nil)
        tour.endIfActive()
        if keepCameraOnClose {
            keepCameraOnClose = false
        } else {
            model.recorder.launcherDidClose()
        }
    }

    // MARK: Dismissal

    private var dismissMonitors: [Any] = []

    /// Closes the launcher on a click outside Umi, a click in Umi outside the launcher
    /// and its companions (bubble, tour), or Escape.
    private func startDismissMonitors() {
        stopDismissMonitors()
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            self?.closePopover()
        }) { dismissMonitors.append(global) }

        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown], handler: { [weak self] event in
            guard let self else { return event }
            if event.type == .keyDown {
                if event.keyCode == 53 { closePopover(); return nil } // Escape
                return event
            }
            if !isCompanionClick(event) { closePopover() }
            return event
        }) { dismissMonitors.append(local) }
    }

    private func stopDismissMonitors() {
        dismissMonitors.forEach(NSEvent.removeMonitor)
        dismissMonitors = []
    }

    private func isCompanionClick(_ event: NSEvent) -> Bool {
        let point = NSEvent.mouseLocation
        if popover.contentViewController?.view.window?.frame.contains(point) == true { return true }
        if item.button?.window?.frame.contains(point) == true { return true } // the status item toggles itself
        if model.recorder.cameraBubbleContains(point) { return true }
        if tour.contains(point) { return true }
        // Menus opened from the launcher (source, mic) are their own windows.
        if let window = event.window, window.level.rawValue >= NSWindow.Level.popUpMenu.rawValue { return true }
        return false
    }

    private func closePopover() {
        if popover.isShown { popover.performClose(nil) }
    }
}

