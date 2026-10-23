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
case "notify":
    DistributedNotificationCenter.default().postNotificationName(.init(args.dropFirst().first!), object: nil, userInfo: nil, deliverImmediately: true)
case "trusted":
    print(AXIsProcessTrusted())
default:
    print("usage: windows | click x y | trusted")
}
