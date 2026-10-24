import AppKit
import CoreGraphics

// Tiny UI driver for Umi: list its windows, click at a global (top-left) point.
let args = CommandLine.arguments.dropFirst()
switch args.first {
case "windows":
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
    for w in list where (w[kCGWindowOwnerName as String] as? String) == "Umi" {
        let b = w[kCGWindowBounds as String] as! [String: CGFloat]
        print("id=\(w[kCGWindowNumber as String]!) alpha=\(w[kCGWindowAlpha as String]!) layer=\(w[kCGWindowLayer as String]!) x=\(Int(b["X"]!)) y=\(Int(b["Y"]!)) w=\(Int(b["Width"]!)) h=\(Int(b["Height"]!))")
    }
case "click":
    let p = CGPoint(x: Double(args.dropFirst().first!)!, y: Double(args.dropFirst(2).first!)!)
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(60_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
case "drag":
    let v = args.dropFirst().compactMap(Double.init)
    let from = CGPoint(x: v[0], y: v[1]), to = CGPoint(x: v[2], y: v[3])
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: from, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80_000)
    for i in 1...20 {
        let t = Double(i) / 20
        let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(25_000)
    }
    usleep(80_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)?.post(tap: .cghidEventTap)
case "key", "cmdkey":
    let code = CGKeyCode(Int(args.dropFirst().first!)!)
    let flags: CGEventFlags = args.first == "cmdkey" ? .maskCommand : []
    let src = CGEventSource(stateID: .hidSystemState)
    // Explicit empty flags: the HID source state can carry stray modifiers (e.g. ⌘).
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
case "down", "move", "up":
    // Step-by-step drag, so a test can look at the screen mid-gesture.
    let v = args.dropFirst().compactMap(Double.init)
    let p = CGPoint(x: v[0], y: v[1])
    let type: CGEventType = args.first == "down" ? .leftMouseDown : args.first == "up" ? .leftMouseUp : .leftMouseDragged
    let src = CGEventSource(stateID: .hidSystemState)
    if args.first == "down" {
        CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(60_000)
    }
    if args.first == "move", v.count >= 4 {
        // move fromX fromY toX toY: interpolate in small steps
        let from = p, to = CGPoint(x: v[2], y: v[3])
        for i in 1...12 {
            let t = Double(i) / 12
            CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t), mouseButton: .left)?.post(tap: .cghidEventTap)
            usleep(25_000)
        }
    } else {
        CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    }
case "type":
    // Types text as keyboard input (unicode), one character at a time.
    let text = args.dropFirst().joined(separator: " ")
    let src = CGEventSource(stateID: .hidSystemState)
    for scalar in text.utf16 {
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)
            var unit = scalar
            event?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
            event?.flags = []
            event?.post(tap: .cghidEventTap)
            usleep(12_000)
        }
    }
case "optshiftkey":
    let code = CGKeyCode(Int(args.dropFirst().first!)!)
    let src = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
        event?.flags = [.maskAlternate, .maskShift]
        event?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
case "cmdshiftkey":
    let code = CGKeyCode(Int(args.dropFirst().first!)!)
    let src = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
        event?.flags = [.maskCommand, .maskShift]
        event?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
case "frontmost":
    print(NSWorkspace.shared.frontmostApplication?.localizedName ?? "")
case "notify":
    DistributedNotificationCenter.default().postNotificationName(.init(args.dropFirst().first!), object: nil, userInfo: nil, deliverImmediately: true)
case "trusted":
    print(AXIsProcessTrusted())
default:
    print("usage: windows | click x y | trusted")
}
