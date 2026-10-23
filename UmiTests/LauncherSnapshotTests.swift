import SwiftUI
import XCTest
@testable import Umi

/// Renders the launcher and control bar to /tmp/umi-fixtures for a visual check.
final class LauncherSnapshotTests: XCTestCase {
    @MainActor
    func testRenderLauncher() throws {
        let dir = URL(fileURLWithPath: "/tmp/umi-fixtures")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        UserDefaults.standard.set(2, forKey: "onboardingStep")
        let recorder = AppModel.shared.recorder
        for scheme in [ColorScheme.light, .dark] {
            let view = MenuBarView()
                .environment(recorder)
                .environment(RecordingsLibrary())
                .background(scheme == .dark ? Color(white: 0.16) : Color(white: 0.96))
                .environment(\.colorScheme, scheme)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.nsImage)
            let data = try XCTUnwrap(NSBitmapImageRep(data: image.tiffRepresentation!)?.representation(using: .png, properties: [:]))
            try data.write(to: dir.appendingPathComponent("launcher-\(scheme == .dark ? "dark" : "light").png"))
        }
        let bar = ImageRenderer(content: ControlBarView(recorder: recorder).padding(20).background(Color.gray))
        bar.scale = 2
        let barData = NSBitmapImageRep(data: bar.nsImage!.tiffRepresentation!)!.representation(using: .png, properties: [:])!
        try barData.write(to: dir.appendingPathComponent("controlbar.png"))
        for (name, step, right) in [("welcome", OnboardingStep.welcome, true), ("bubble", OnboardingStep.bubble, false)] {
            let r = ImageRenderer(content: TourCallout(step: step, pointsRight: right, next: {}, close: {}).background(Color(white: 0.45)))
            r.scale = 2
            let d = NSBitmapImageRep(data: r.nsImage!.tiffRepresentation!)!.representation(using: .png, properties: [:])!
            try d.write(to: dir.appendingPathComponent("tour-\(name).png"))
        }
        UserDefaults.standard.removeObject(forKey: "onboardingStep")
    }
}
