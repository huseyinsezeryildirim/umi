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
    }
}

enum WindowID {
    static let library = "library"
}
