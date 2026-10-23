import CoreMedia
import os

/// The single time base every track and the cursor log is written against.
///
/// Inputs are host-clock timestamps (what ScreenCaptureKit, AVCapture and
/// `CACurrentMediaTime` all use). Output is "recording time": seconds since start
/// with paused stretches removed, so pausing shifts every track by the same amount.
nonisolated final class RecordingClock: Sendable {
    private struct State {
        var start: CMTime?
        var pausedAt: CMTime?
        var pauses: [CMTimeRange] = []
        var stoppedAt: CMTime?
    }

    private let state = OSAllocatedUnfairLock(initialState: State())

    static var hostNow: CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }

    func start() {
        state.withLock { $0 = State(start: Self.hostNow) }
    }

    func pause() {
        state.withLock { s in
            if s.pausedAt == nil { s.pausedAt = Self.hostNow }
        }
    }

    func resume() {
        state.withLock { s in
            guard let pausedAt = s.pausedAt else { return }
            s.pauses.append(CMTimeRange(start: pausedAt, end: Self.hostNow))
            s.pausedAt = nil
        }
    }

    /// Stops accepting samples and returns the recording's duration.
    func stop() -> CMTime {
        state.withLock { s in
            let now = Self.hostNow
            if let pausedAt = s.pausedAt {
                s.pauses.append(CMTimeRange(start: pausedAt, end: now))
                s.pausedAt = nil
            }
            s.stoppedAt = now
            return Self.map(now, in: s) ?? .zero
        }
    }

    /// Recording time for a host timestamp, or `nil` if it falls before start,
    /// inside a pause, or after stop.
    func map(_ hostTime: CMTime) -> CMTime? {
        state.withLock { s in
            if let pausedAt = s.pausedAt, hostTime >= pausedAt { return nil }
            if let stoppedAt = s.stoppedAt, hostTime > stoppedAt { return nil }
            return Self.map(hostTime, in: s)
        }
    }

    var now: CMTime? { map(Self.hostNow) }

    /// Recording time shown to the user; holds still while paused.
    var elapsed: CMTime {
        state.withLock { s in
            Self.map(s.pausedAt ?? s.stoppedAt ?? Self.hostNow, in: s) ?? .zero
        }
    }

    private static func map(_ hostTime: CMTime, in s: State) -> CMTime? {
        guard let start = s.start, hostTime >= start else { return nil }
        var paused = CMTime.zero
        for range in s.pauses {
            if range.containsTime(hostTime) { return nil }
            if range.end <= hostTime { paused = paused + range.duration }
        }
        return hostTime - start - paused
    }
}
