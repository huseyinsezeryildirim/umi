import Carbon.HIToolbox

/// System-wide shortcuts via Carbon hot keys (no Accessibility permission needed).
/// Defaults match Loom's so switching users keep their muscle memory.
final class HotKeys {
    enum Action: UInt32, CaseIterable {
        case startStop = 1, pauseResume, cancel, launcher, screenshot

        var keyCode: Int {
            switch self {
            case .startStop: kVK_ANSI_L
            case .pauseResume: kVK_ANSI_P
            case .cancel: kVK_ANSI_C
            case .launcher: kVK_ANSI_U
            case .screenshot: kVK_ANSI_4
            }
        }

        var display: String {
            switch self {
            case .startStop: "⌥⇧L"
            case .pauseResume: "⌥⇧P"
            case .cancel: "⌥⇧C"
            case .launcher: "⌥⇧U"
            case .screenshot: "⌥⇧4"
            }
        }
    }

    private var handlers: [UInt32: () -> Void] = [:]
    private var refs: [EventHotKeyRef] = []
    private var eventHandler: EventHandlerRef?

    func register(_ action: Action, handler: @escaping () -> Void) {
        installIfNeeded()
        handlers[action.rawValue] = handler
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: OSType(0x554D_4931), id: action.rawValue) // 'UMI1'
        if RegisterEventHotKey(UInt32(action.keyCode), UInt32(optionKey | shiftKey), id, GetApplicationEventTarget(), 0, &ref) == noErr, let ref {
            refs.append(ref)
        }
    }

    private func installIfNeeded() {
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
