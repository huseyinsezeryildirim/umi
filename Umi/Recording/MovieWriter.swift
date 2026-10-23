import AVFoundation
import os

/// Writes one movie file: an optional H.264 video track plus any number of AAC audio tracks.
/// Samples arrive with host-clock timestamps and are retimed to recording time.
/// Fragmented writing keeps the file playable if the app crashes mid-recording.
nonisolated final class MovieWriter: @unchecked Sendable {
    struct Video {
        var width: Int
        var height: Int
        var fps: Int
    }

    struct Audio {
        var channels: Int
    }

    private let writer: AVAssetWriter
    private let videoInput: AVAssetWriterInput?
    private let audioInputs: [AVAssetWriterInput]
    private let lock = OSAllocatedUnfairLock()
    private var lastVideoTime = CMTime.negativeInfinity
    private var finished = false

    init(url: URL, video: Video?, audio: [Audio]) throws {
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        writer.movieFragmentInterval = CMTime(seconds: 2, preferredTimescale: 600)

        if let video {
            let pixels = Double(video.width * video.height)
            let bitrate = min(max(pixels * Double(video.fps) * 0.15, 4_000_000), 60_000_000)
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: video.width,
                AVVideoHeightKey: video.height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: bitrate,
                    AVVideoExpectedSourceFrameRateKey: video.fps,
                    AVVideoMaxKeyFrameIntervalKey: video.fps * 2,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                ],
            ])
            input.expectsMediaDataInRealTime = true
            writer.add(input)
            videoInput = input
        } else {
            videoInput = nil
        }

        audioInputs = audio.map { audio in
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48_000,
                AVNumberOfChannelsKey: audio.channels,
                AVEncoderBitRateKey: audio.channels == 1 ? 96_000 : 160_000,
            ])
            input.expectsMediaDataInRealTime = true
            return input
        }
        audioInputs.forEach(writer.add)

        guard writer.startWriting() else {
            throw writer.error ?? CocoaError(.fileWriteUnknown)
        }
        writer.startSession(atSourceTime: .zero)
    }

    func appendVideo(_ buffer: CMSampleBuffer, at time: CMTime) {
        lock.withLockUnchecked {
            guard !finished, let input = videoInput, input.isReadyForMoreMediaData, time > lastVideoTime,
                  let retimed = buffer.retimed(to: time) else { return }
            if input.append(retimed) { lastVideoTime = time }
        }
    }

    func appendAudio(_ buffer: CMSampleBuffer, track: Int, at time: CMTime) {
        lock.withLockUnchecked {
            guard !finished, audioInputs.indices.contains(track) else { return }
            let input = audioInputs[track]
            guard input.isReadyForMoreMediaData, let retimed = buffer.retimed(to: time) else { return }
            input.append(retimed)
        }
    }

    func finish(at end: CMTime) async {
        let ready: Bool = lock.withLock {
            guard !finished else { return false }
            finished = true
            return writer.status == .writing
        }
        guard ready else { return }
        videoInput?.markAsFinished()
        audioInputs.forEach { $0.markAsFinished() }
        writer.endSession(atSourceTime: end)
        await writer.finishWriting()
    }

    func cancel() {
        lock.withLock {
            finished = true
            if writer.status == .writing { writer.cancelWriting() }
        }
    }
}

nonisolated extension CMSampleBuffer {
    /// A copy whose first sample is presented at `time`, keeping relative spacing.
    func retimed(to time: CMTime) -> CMSampleBuffer? {
        guard let timings = try? sampleTimingInfos(), let first = timings.first else { return nil }
        let delta = time - first.presentationTimeStamp
        let shifted = timings.map { timing in
            CMSampleTimingInfo(
                duration: timing.duration,
                presentationTimeStamp: timing.presentationTimeStamp + delta,
                decodeTimeStamp: timing.decodeTimeStamp.isValid ? timing.decodeTimeStamp + delta : .invalid
            )
        }
        return try? CMSampleBuffer(copying: self, withNewTiming: shifted)
    }
}
