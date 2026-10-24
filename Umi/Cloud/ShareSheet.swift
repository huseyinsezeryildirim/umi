import AppKit
import SwiftUI

/// Loom-style share window: get a link, share it at a moment, protect it, and copy embed or
/// GIF-thumbnail code for docs and email.
struct ShareSheet: View {
    let service: ShareService
    /// The editor's playhead, for "Start at".
    var currentTime: Double = 0
    @Environment(\.dismiss) private var dismiss
    @State private var tab = Tab.link
    @State private var configured = CloudConfig.isConfigured

    enum Tab: String, CaseIterable { case link = "Link", embed = "Embed" }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Share").font(.title2.bold())
                Spacer()
                if service.video != nil {
                    Picker("", selection: $tab) {
                        ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                }
            }

            if !configured {
                CloudSetupView { configured = CloudConfig.isConfigured }
            } else if service.video == nil {
                start
            } else {
                progress
                switch tab {
                case .link: LinkTab(service: service, currentTime: currentTime)
                case .embed: EmbedTab(service: service)
                }
            }

            HStack {
                if configured {
                    Button("Account…") { configured = false }
                        .buttonStyle(.link)
                        .font(.caption)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(20)
        .frame(width: 480)
    }

    @ViewBuilder
    private var start: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Upload this video and get a link anyone can watch, no account needed. The link is copied as soon as it's ready, even while the video uploads.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            progress
            if case .failed(let message) = service.phase {
                Text(message).font(.callout).foregroundStyle(UmiTheme.record)
                if service.needsPlan {
                    Text("Cloud links are part of Umi Cloud. Recording, editing and exporting stay free forever.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Button {
                service.share()
            } label: {
                Label(service.isBusy ? "Uploading…" : "Create Link", systemImage: "link").frame(maxWidth: .infinity)
            }
            .buttonStyle(InkButtonStyle(height: 40))
            .disabled(service.isBusy)
        }
    }

    @ViewBuilder
    private var progress: some View {
        switch service.phase {
        case .exporting(let p):
            ProgressView(value: p) { Text("Preparing video… \(Int(p * 100))%").font(.caption) }
        case .uploading(let p):
            ProgressView(value: p) { Text("Uploading… \(Int(p * 100))% · the link already works").font(.caption) }
        default:
            EmptyView()
        }
    }
}

// MARK: - Link

private struct LinkTab: View {
    let service: ShareService
    let currentTime: Double
    @State private var startAtTime = false
    @State private var copied = false
    @State private var usePassword = false
    @State private var password = ""
    @State private var expiry = Expiry.never
    @State private var allowDownload = true
    @State private var allowComments = true
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    enum Expiry: String, CaseIterable, Identifiable {
        case never = "Never", day = "1 day", week = "7 days", month = "30 days"
        var id: String { rawValue }
        var interval: TimeInterval? {
            switch self {
            case .never: nil
            case .day: 86_400
            case .week: 7 * 86_400
            case .month: 30 * 86_400
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text(service.link(at: startAtTime ? currentTime : nil)?.absoluteString ?? "")
                    .font(.system(size: 13, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.secondary.opacity(0.1)))
                Button {
                    service.copyLink(at: startAtTime ? currentTime : nil)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy Link", systemImage: copied ? "checkmark" : "link")
                }
                .buttonStyle(InkCompactButtonStyle())
            }
            if currentTime >= 1 {
                Toggle("Start at \(currentTime.formattedDuration)", isOn: $startAtTime)
                    .onChange(of: startAtTime) { copied = false }
            }

            Divider()
            Toggle("Password", isOn: $usePassword)
            if usePassword {
                HStack {
                    SecureField(service.video?.hasPassword == true ? "Set a new password" : "At least 4 characters", text: $password)
                        .textFieldStyle(.roundedBorder)
                    Button("Save") { save(.init(password: password)) }
                        .disabled(password.count < 4 || saving)
                }
            }
            Picker("Link expires", selection: $expiry) {
                ForEach(Expiry.allCases) { Text($0.rawValue).tag($0) }
            }
            Toggle("Viewers can download", isOn: $allowDownload)
            Toggle("Comments and reactions", isOn: $allowComments)

            if let error { Text(error).font(.caption).foregroundStyle(UmiTheme.record) }

            HStack {
                Button("Open in Browser") { if let url = service.video?.url { NSWorkspace.shared.open(url) } }
                Spacer()
                Button("Delete Link", role: .destructive) { confirmDelete = true }
            }
        }
        .toggleStyle(.switch)
        .onAppear(perform: load)
        .onChange(of: usePassword) { _, on in
            if !on, service.video?.hasPassword == true { save(.init(password: "")) }
        }
        .onChange(of: expiry) { _, value in
            save(.init(expiresAt: .some(value.interval.map { Date().addingTimeInterval($0) })))
        }
        .onChange(of: allowDownload) { _, value in if value != service.video?.allowDownload { save(.init(allowDownload: value)) } }
        .onChange(of: allowComments) { _, value in if value != (service.video?.allowComments ?? true) { save(.init(allowComments: value)) } }
        .confirmationDialog("Delete this link?", isPresented: $confirmDelete) {
            Button("Delete Link", role: .destructive) {
                Task { do { try await service.deleteLink() } catch { self.error = error.localizedDescription } }
            }
        } message: {
            Text("The video is removed from Umi Cloud and the link stops working. Your recording stays on this Mac.")
        }
    }

    private func load() {
        guard let video = service.video else { return }
        usePassword = video.hasPassword
        allowDownload = video.allowDownload
        allowComments = video.allowComments ?? true
        if let expires = video.expiresAt {
            let days = expires.timeIntervalSinceNow / 86_400
            expiry = days < 2 ? .day : days < 10 ? .week : .month
        }
    }

    private func save(_ settings: CloudClient.Settings) {
        saving = true
        error = nil
        Task {
            do {
                try await service.update(settings)
                if settings.password?.isEmpty == false { password = "" }
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}

// MARK: - Embed

private struct EmbedTab: View {
    let service: ShareService
    @State private var responsive = true
    @State private var copiedItem: String?

    private var video: CloudVideo? { service.video }

    private var embedURL: URL? {
        guard let video else { return nil }
        return video.url.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("e/\(video.id)")
    }

    private var ratio: Double {
        guard let w = video?.width, let h = video?.height, w > 0, h > 0 else { return 16.0 / 9 }
        return Double(w) / Double(h)
    }

    private var embedCode: String {
        guard let embedURL else { return "" }
        if responsive {
            let padding = String(format: "%.2f", 100 / ratio)
            return #"<div style="position: relative; padding-bottom: \#(padding)%; height: 0;"><iframe src="\#(embedURL)" frameborder="0" allow="fullscreen" allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe></div>"#
        }
        let width = 640, height = Int((640 / ratio).rounded())
        return #"<iframe width="\#(width)" height="\#(height)" src="\#(embedURL)" frameborder="0" allow="fullscreen" allowfullscreen></iframe>"#
    }

    private var gifCode: String {
        guard let video else { return "" }
        let title = video.title.replacingOccurrences(of: "\"", with: "&quot;")
        return #"<a href="\#(video.url)"><img style="max-width: 300px;" src="\#(video.url)/preview.gif" alt="\#(title) – watch video"></a>"#
    }

    private var thumbnailCode: String {
        guard let video else { return "" }
        let title = video.title.replacingOccurrences(of: "\"", with: "&quot;")
        return #"<a href="\#(video.url)"><img style="max-width: 300px;" src="\#(video.url)/thumbnail.jpg" alt="\#(title) – watch video"></a>"#
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("Size", selection: $responsive) {
                Text("Responsive").tag(true)
                Text("Fixed (640 px)").tag(false)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            codeBlock("Embed", code: embedCode, hint: "Paste into a website, Notion or a help center.")
            codeBlock("GIF thumbnail", code: gifCode, hint: "A moving preview that links to the video. Great for email.")
            codeBlock("Thumbnail", code: thumbnailCode, hint: "A still image that links to the video.")
        }
    }

    private func codeBlock(_ title: String, code: String, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copiedItem = title
                } label: {
                    Label(copiedItem == title ? "Copied" : "Copy Code", systemImage: copiedItem == title ? "checkmark" : "doc.on.doc")
                }
                .controlSize(.small)
            }
            Text(code)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(3)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.secondary.opacity(0.08)))
            Text(hint).font(.caption).foregroundStyle(.tertiary)
        }
    }
}

// MARK: - Account

/// Until sign-in exists: the server address and an account token.
private struct CloudSetupView: View {
    let done: () -> Void
    @State private var server = CloudConfig.baseURL.absoluteString
    @State private var token = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Connect Umi Cloud")
                .font(.headline)
            Text("Links need an Umi Cloud plan. Recording, editing and exporting stay free, with no limits.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Server", text: $server).textFieldStyle(.roundedBorder)
            SecureField("Account token", text: $token).textFieldStyle(.roundedBorder)
            HStack {
                if CloudConfig.isConfigured {
                    Button("Sign Out", role: .destructive) { CloudConfig.token = nil; token = "" }
                }
                Spacer()
                Button("Connect") {
                    if let url = URL(string: server.trimmingCharacters(in: .whitespaces)), url.scheme?.hasPrefix("http") == true {
                        CloudConfig.baseURL = url
                    }
                    if !token.isEmpty { CloudConfig.token = token }
                    done()
                }
                .buttonStyle(.borderedProminent)
                .disabled(token.isEmpty && !CloudConfig.isConfigured)
            }
        }
    }
}
