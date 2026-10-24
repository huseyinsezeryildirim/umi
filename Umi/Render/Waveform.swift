import AVFoundation

/// Loudness peaks of a recording's voice track, for drawing on the timeline.
nonisolated enum Waveform {
    static let samplesPerSecond = 50.0

    /// Peaks (0…1) at `samplesPerSecond`, from the mic track (or the first audio track).
    static func load(_ url: URL, preferredTrack: Int?) async -> [Float] {
        let asset = AVURLAsset(url: url)
        guard let tracks = try? await asset.loadTracks(withMediaType: .audio), !tracks.isEmpty else { return [] }
        let track = preferredTrack.flatMap { tracks.indices.contains($0) ? tracks[$0] : nil } ?? tracks[0]
        guard let reader = try? AVAssetReader(asset: asset) else { return [] }
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false, AVNumberOfChannelsKey: 1, AVSampleRateKey: 8000,
        ])
        reader.add(output)
        guard reader.startReading() else { return [] }
        let bucket = Int(8000 / samplesPerSecond)
        var peaks: [Float] = [], current: Int16 = 0, count = 0
        while let buffer = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(buffer) {
            var length = 0
            var pointer: UnsafeMutablePointer<CChar>?
            CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer)
            guard let pointer else { continue }
            pointer.withMemoryRebound(to: Int16.self, capacity: length / 2) { samples in
                for i in 0..<(length / 2) {
                    current = max(current, samples[i] == Int16.min ? Int16.max : abs(samples[i]))
                    count += 1
                    if count == bucket {
                        peaks.append(Float(current) / Float(Int16.max))
                        current = 0
                        count = 0
                    }
                }
            }
        }
        // Normalize so quiet recordings still read.
        let top = max(peaks.max() ?? 1, 0.05)
        return peaks.map { min($0 / top, 1) }
    }
}
