import AppKit
import Observation
import SwiftUI

/// Instant mode: when a recording stops, export it with the default look and put the
/// video on the clipboard, with a small card to share it, find it or open the editor.
///
/// Link sharing (upload + copy link) plugs in here once Umi Cloud is live.
@Observable
final class InstantShareController {
    enum State: Equatable {
        case preparing(Double)
        case ready(URL)
        case failed(String)
    }

    private(set) var state: State = .preparing(0)
    private(set) var bundle: URL?
    private var panel: NSPanel?
    private var dismissTask: Task<Void, Never>?

    func run(bundle: URL) {
        self.bundle = bundle
        state = .preparing(0)
        show()
        Task {
            do {
                let folder = try RecordingsLibrary.folderURL().appendingPathComponent("Exports", isDirectory: true)
                let url = try await Self.exportPolished(bundle, to: folder) { value in
                    Task { @MainActor in self.state = .preparing(value) }
                }
                copyToClipboard(url)
                state = .ready(url)
                scheduleDismiss()
            } catch {
                state = .failed(error.localizedDescription)
            }
        }
    }

    /// Exports a recording with its edit (or the default look) as a 1080p MP4 in `folder`.
    static func exportPolished(_ bundle: URL, to folder: URL, progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        var project = try ProjectStore.read(RecordingProject.self, from: bundle.appendingPathComponent(RecordingProject.fileName))
        project.edit = project.edit ?? project.defaultEdit
        let cursor = (try? ProjectStore.read(CursorData.self, from: bundle.appendingPathComponent(RecordingProject.cursorFile))) ?? CursorData()
        let renderer = FrameRenderer(project: project, cursorData: cursor, cursorImage: .arrow, bundle: bundle)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(bundle.deletingPathExtension().lastPathComponent).appendingPathExtension("mp4")
        try await Exporter.export(bundle: bundle, renderer: renderer, resolution: .p1080, fps: 30, to: destination, progress: progress)
        return destination
    }

    /// The file itself goes on the clipboard, so ⌘V in Slack, Mail or Messages attaches it.
    private func copyToClipboard(_ url: URL) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.writeObjects([url as NSURL])
    }

    // MARK: Card

    func openEditor() {
        guard let bundle else { return }
        close()
        AppModel.shared.openEditor(bundle)
    }

    func close() {
        dismissTask?.cancel()
        panel?.orderOut(nil)
        panel = nil
    }

    /// Keeps the card up while the pointer is on it.
    func hovering(_ inside: Bool) {
        if inside { dismissTask?.cancel() } else if case .ready = state { scheduleDismiss() }
    }

    private func scheduleDismiss() {
        dismissTask?.cancel()
        dismissTask = Task {
            try? await Task.sleep(for: .seconds(20))
            guard !Task.isCancelled else { return }
            close()
        }
    }

    private func show() {
        guard panel == nil else { return }
        let size = CGSize(width: 340, height: 150)
        let screen = NSScreen.main?.visibleFrame ?? .zero
        let frame = CGRect(x: screen.maxX - size.width - 20, y: screen.minY + 20, width: size.width, height: size.height)
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = FirstMouseHostingView(rootView: InstantShareCard(controller: self))
        panel.orderFrontRegardless()
        self.panel = panel
    }
}

private struct InstantShareCard: View {
    let controller: InstantShareController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                UmiMark(size: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(UmiTheme.ink)
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(UmiTheme.secondary).lineLimit(2)
                }
                Spacer(minLength: 0)
                Button { controller.close() } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)) }
                    .buttonStyle(GlassIconButtonStyle(size: 24))
            }
            switch controller.state {
            case .preparing(let progress):
                ProgressView(value: progress).tint(UmiTheme.accent)
            case .ready(let url):
                HStack(spacing: 8) {
                    ShareLink(item: url) { Label("Share…", systemImage: "square.and.arrow.up") }
                        .buttonStyle(InkCompactButtonStyle())
                    Button { NSWorkspace.shared.activateFileViewerSelecting([url]) } label: { Label("Finder", systemImage: "folder") }
                        .buttonStyle(GlassButtonStyle(height: 32, cornerRadius: 10))
                    Button { controller.openEditor() } label: { Label("Edit", systemImage: "slider.horizontal.3") }
                        .buttonStyle(GlassButtonStyle(height: 32, cornerRadius: 10))
                }
                .font(.system(size: 13, weight: .medium))
            case .failed:
                Button("Open in editor") { controller.openEditor() }
                    .buttonStyle(GlassButtonStyle(height: 32, cornerRadius: 10))
            }
        }
        .padding(16)
        .frame(width: 340)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(UmiTheme.iceWash).shadow(color: .black.opacity(0.18), radius: 16, y: 6))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(UmiTheme.hairline, lineWidth: 0.5))
        .padding(4)
        .onHover { controller.hovering($0) }
        .environment(\.colorScheme, .light)
    }

    private var title: String {
        switch controller.state {
        case .preparing: "Polishing your video…"
        case .ready: "Copied to clipboard"
        case .failed: "Couldn't prepare the video"
        }
    }

    private var subtitle: String {
        switch controller.state {
        case .preparing(let p): "Background, auto zoom and camera applied · \(Int(p * 100))%"
        case .ready: "Paste it into Slack, Mail or Messages, or share it."
        case .failed(let message): message
        }
    }
}

/// A compact ink capsule button for cards.
struct InkCompactButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .background(Capsule().fill(UmiTheme.ink))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .contentShape(Capsule())
    }
}
