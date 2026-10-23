import SwiftUI

@main
struct UmiApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // The menu bar item and launcher popover live in StatusBarController (AppKit),
        // which supports a right-click menu that MenuBarExtra can't.
        Window("Umi Library", id: WindowID.library) {
            LibraryView()
                .environment(AppModel.shared.library)
                .frame(minWidth: 760, minHeight: 460)
        }
        .defaultSize(width: 960, height: 600)
        .defaultLaunchBehavior(.suppressed)

        WindowGroup("Editor", id: WindowID.editor, for: URL.self) { $bundle in
            if let bundle {
                EditorView(bundle: bundle)
                    .frame(minWidth: 900, minHeight: 600)
            }
        }
        .defaultSize(width: 1280, height: 820)
        .defaultLaunchBehavior(.suppressed)
    }
}

enum WindowID {
    static let library = "library"
    static let editor = "editor"
}
