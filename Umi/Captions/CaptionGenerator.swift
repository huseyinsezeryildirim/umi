import AVFoundation
import Speech

/// Transcribes a recording on this Mac with Apple's speech recognizer. On-device
/// recognition is required, so audio never leaves the computer.
enum CaptionGenerator {
    enum Failure: LocalizedError {
        case notAuthorized, unsupportedLanguage, noAudio

        var errorDescription: String? {
            switch self {
            case .notAuthorized: "Speech recognition is off for Umi. Enable it in System Settings › Privacy & Security › Speech Recognition."
            case .unsupportedLanguage: "This language can't be transcribed on this Mac. Pick another one, or download it in System Settings › Keyboard › Dictation."
            case .noAudio: "This recording has no audio to transcribe."
            }
        }
    }

    /// Languages that can be transcribed fully on this Mac.
    static var onDeviceLocales: [Locale] {
        SFSpeechRecognizer.supportedLocales()
            .filter { SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true }
            .sorted { $0.localizedString(forIdentifier: $0.identifier) ?? $0.identifier < $1.localizedString(forIdentifier: $1.identifier) ?? $1.identifier }
    }

    static func transcribe(bundle: URL, project: RecordingProject, locale: Locale,
                           progress: @escaping @Sendable (String) -> Void) async throws -> [EditSettings.CaptionWord] {
        guard await authorize() else { throw Failure.notAuthorized }
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.supportsOnDeviceRecognition else { throw Failure.unsupportedLanguage }

        progress("Preparing audio…")
        let audio = try await extractVoice(bundle: bundle, project: project)
        defer { try? FileManager.default.removeItem(at: audio) }

        progress("Transcribing on this Mac…")
        let request = SFSpeechURLRecognitionRequest(url: audio)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.addsPunctuation = true
        request.taskHint = .dictation

        return try await withCheckedThrowingContinuation { continuation in
            var finished = false
            recognizer.recognitionTask(with: request) { result, error in
                guard !finished else { return }
                if let result, result.isFinal {
                    finished = true
                    continuation.resume(returning: result.bestTranscription.segments.map { segment in
                        EditSettings.CaptionWord(start: segment.timestamp, end: segment.timestamp + max(segment.duration, 0.12), text: segment.substring)
                    })
                } else if let error {
                    finished = true
                    // "No speech detected" is an empty result, not a failure.
                    if (error as NSError).code == 1110 { continuation.resume(returning: []) } else { continuation.resume(throwing: error) }
                }
            }
        }
    }

    private static func authorize() async -> Bool {
        if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
    }

    /// The microphone track (or all audio if there's no separate mic) as an m4a file,
    /// on the recording's own timeline so word times line up with the source.
    private static func extractVoice(bundle: URL, project: RecordingProject) async throws -> URL {
        let asset = AVURLAsset(url: bundle.appendingPathComponent(RecordingProject.screenFile))
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        guard !tracks.isEmpty else { throw Failure.noAudio }
        let chosen: [AVAssetTrack]
        if let mic = project.audio.microphoneTrack, tracks.indices.contains(mic) { chosen = [tracks[mic]] } else { chosen = tracks }

        let composition = AVMutableComposition()
        for track in chosen {
            let range = try await track.load(.timeRange)
            let out = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
            try out?.insertTimeRange(range, of: track, at: range.start)
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("umi-voice-\(UUID().uuidString).m4a")
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else { throw Failure.noAudio }
        try await export.export(to: url, as: .m4a)
        return url
    }
}

nonisolated enum SubtitleFormat: String, CaseIterable {
    case srt, vtt
}

/// Writes captions as SRT or WebVTT, timed on the edited (output) timeline.
nonisolated enum SubtitleWriter {
    static func write(_ words: [EditSettings.CaptionWord], format: SubtitleFormat, mapTime: (Double) -> Double?, to url: URL) throws {
        var cues: [(Double, Double, String)] = []
        for line in TextRenderer.lines(words) {
            guard let start = mapTime(line.first!.start), let end = mapTime(line.last!.end) else { continue }
            cues.append((start, max(end, start + 0.5), line.map(\.text).joined(separator: " ")))
        }
        var out = format == .vtt ? "WEBVTT\n\n" : ""
        for (i, cue) in cues.enumerated() {
            if format == .srt { out += "\(i + 1)\n" }
            out += "\(stamp(cue.0, format)) --> \(stamp(cue.1, format))\n\(cue.2)\n\n"
        }
        try out.write(to: url, atomically: true, encoding: .utf8)
    }

    private static func stamp(_ t: Double, _ format: SubtitleFormat) -> String {
        let ms = Int((t * 1000).rounded())
        let h = ms / 3_600_000, m = ms / 60_000 % 60, s = ms / 1000 % 60, f = ms % 1000
        return String(format: format == .srt ? "%02d:%02d:%02d,%03d" : "%02d:%02d:%02d.%03d", h, m, s, f)
    }
}
