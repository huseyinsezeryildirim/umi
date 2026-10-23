import SwiftUI

@main
struct UmiApp: App {
    @State private var recorder = RecordingController()
    @State private var library = RecordingsLibrary()

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environment(recorder)
                .environment(library)
        } label: {
            MenuBarLabel()
                .environment(recorder)
        }
        .menuBarExtraStyle(.window)

        Window("Umi Library", id: WindowID.library) {
            LibraryView()
                .environment(library)
                .frame(minWidth: 760, minHeight: 460)
        }
        .defaultSize(width: 960, height: 600)

        WindowGroup("Editor", id: WindowID.editor, for: URL.self) { $bundle in
            if let bundle {
                EditorView(bundle: bundle)
                    .frame(minWidth: 900, minHeight: 600)
            }
        }
        .defaultSize(width: 1280, height: 820)
    }
}

enum WindowID {
    static let library = "library"
    static let editor = "editor"
}
