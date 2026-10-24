import AppKit
import Carbon.HIToolbox
import Observation

/// A key plus modifiers, as Carbon wants them. Saved per action in UserDefaults.
struct Shortcut: Codable, Hashable {
    var keyCode: Int
    /// Carbon modifier mask (cmdKey, optionKey, controlKey, shiftKey).
    var modifiers: Int

    init(keyCode: Int, modifiers: Int) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    /// From a key event; nil unless it has ⌘, ⌥ or ⌃ (plain keys would hijack typing).
    init?(event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var carbon = 0
        if flags.contains(.command) { carbon |= cmdKey }
        if flags.contains(.option) { carbon |= optionKey }
        if flags.contains(.control) { carbon |= controlKey }
        if flags.contains(.shift) { carbon |= shiftKey }
        guard carbon & (cmdKey | optionKey | controlKey) != 0 else { return nil }
        keyCode = Int(event.keyCode)
        modifiers = carbon
    }

    var display: String {
        var s = ""
        if modifiers & controlKey != 0 { s += "⌃" }
        if modifiers & optionKey != 0 { s += "⌥" }
        if modifiers & shiftKey != 0 { s += "⇧" }
        if modifiers & cmdKey != 0 { s += "⌘" }
        return s + Self.keyName(keyCode)
    }

    private static func keyName(_ code: Int) -> String {
        let special: [Int: String] = [
            kVK_Space: "Space", kVK_Return: "↩", kVK_Tab: "⇥", kVK_Escape: "⎋", kVK_Delete: "⌫",
            kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_UpArrow: "↑", kVK_DownArrow: "↓",
            kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6",
            kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12",
        ]
        if let name = special[code] { return name }
        // The character this key types on the current layout.
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return "?" }
        let layout = unsafeBitCast(data, to: CFData.self)
        var deadKeys: UInt32 = 0
        var chars = [UniChar](repeating: 0, count: 4)
        var length = 0
        let status = CFDataGetBytePtr(layout).withMemoryRebound(to: UCKeyboardLayout.self, capacity: 1) { ptr in
            UCKeyTranslate(ptr, UInt16(code), UInt16(kUCKeyActionDisplay), 0, UInt32(LMGetKbdType()),
                           OptionBits(kUCKeyTranslateNoDeadKeysBit), &deadKeys, chars.count, &length, &chars)
        }
        guard status == noErr, length > 0 else { return "?" }
        return String(utf16CodeUnits: chars, count: length).uppercased()
    }
}

/// System-wide shortcuts via Carbon hot keys (no Accessibility permission needed).
/// Defaults match Loom's so switching users keep their muscle memory; each can be changed.
@Observable
final class HotKeys {
    enum Action: UInt32, CaseIterable, Identifiable {
        case startStop = 1, pauseResume, cancel, launcher, screenshot

        var id: UInt32 { rawValue }

        var title: String {
            switch self {
            case .startStop: "Start / Stop recording"
            case .pauseResume: "Pause / Resume"
            case .cancel: "Cancel recording"
            case .launcher: "Open Umi"
            case .screenshot: "Take screenshot"
            }
        }

        var defaultShortcut: Shortcut {
            let key = switch self {
            case .startStop: kVK_ANSI_L
            case .pauseResume: kVK_ANSI_P
            case .cancel: kVK_ANSI_C
            case .launcher: kVK_ANSI_U
            case .screenshot: kVK_ANSI_4
            }
            return Shortcut(keyCode: key, modifiers: optionKey | shiftKey)
        }

        fileprivate var defaultsKey: String { "shortcut.\(rawValue)" }

        /// The current shortcut, for menus and hints.
        var display: String { HotKeys.shared.shortcut(for: self).display }
    }

    static let shared = HotKeys()

    /// Actions whose shortcut another app already holds.
    private(set) var unavailable: Set<Action> = []
    private var custom: [Action: Shortcut] = [:]
    @ObservationIgnored private var handlers: [UInt32: () -> Void] = [:]
    @ObservationIgnored private var refs: [Action: EventHotKeyRef] = [:]
    @ObservationIgnored private var eventHandler: EventHandlerRef?

    private init() {
        for action in Action.allCases {
            if let data = UserDefaults.standard.data(forKey: action.defaultsKey),
               let shortcut = try? JSONDecoder().decode(Shortcut.self, from: data) {
                custom[action] = shortcut
            }
        }
    }

    func shortcut(for action: Action) -> Shortcut {
        custom[action] ?? action.defaultShortcut
    }

    /// The action already using `shortcut`, if any (other than `action`).
    func conflict(_ shortcut: Shortcut, excluding action: Action) -> Action? {
        Action.allCases.first { $0 != action && self.shortcut(for: $0) == shortcut }
    }

    func setShortcut(_ shortcut: Shortcut?, for action: Action) {
        if let shortcut, shortcut != action.defaultShortcut {
            custom[action] = shortcut
            UserDefaults.standard.set(try? JSONEncoder().encode(shortcut), forKey: action.defaultsKey)
        } else {
            custom[action] = nil
            UserDefaults.standard.removeObject(forKey: action.defaultsKey)
        }
        install(action)
    }

    /// While the shortcut editor listens for keys, the hot keys must not fire.
    func suspend(_ suspended: Bool) {
        for action in Action.allCases {
            if suspended { uninstall(action) } else { install(action) }
        }
    }

    func register(_ action: Action, handler: @escaping () -> Void) {
        installHandlerIfNeeded()
        handlers[action.rawValue] = handler
        install(action)
    }

    private func install(_ action: Action) {
        uninstall(action)
        guard handlers[action.rawValue] != nil else { return }
        let shortcut = shortcut(for: action)
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x554D_4931), id: action.rawValue) // 'UMI1'
        if RegisterEventHotKey(UInt32(shortcut.keyCode), UInt32(shortcut.modifiers), id, GetApplicationEventTarget(), 0, &ref) == noErr, let ref {
            refs[action] = ref
            unavailable.remove(action)
        } else {
            unavailable.insert(action)
        }
    }

    private func uninstall(_ action: Action) {
        if let ref = refs.removeValue(forKey: action) { UnregisterEventHotKey(ref) }
    }

    private func installHandlerIfNeeded() {
        guard eventHandler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &id)
            let hotKeys = Unmanaged<HotKeys>.fromOpaque(context).takeUnretainedValue()
            MainActor.assumeIsolated { hotKeys.handlers[id.id]?() }
            return noErr
        }, 1, &spec, context, &eventHandler)
    }
}
