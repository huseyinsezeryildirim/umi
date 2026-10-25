//! One clock for every source: recording time in seconds, frozen while paused, so all
//! tracks shift together and stay in sync.

use parking_lot::Mutex;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone)]
pub struct Clock(Arc<Mutex<State>>);

struct State {
    start: Instant,
    /// Total time spent paused.
    paused_for: f64,
    /// When the current pause began.
    paused_at: Option<Instant>,
}

impl Default for Clock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(State { start: Instant::now(), paused_for: 0.0, paused_at: None })))
    }

    /// Recording time of the instant `at` (`None` before the start or while paused: drop
    /// what arrives).
    pub fn at(&self, at: Instant) -> Option<f64> {
        let s = self.0.lock();
        if at < s.start || s.paused_at.is_some_and(|p| at >= p) {
            return None;
        }
        let t = at.saturating_duration_since(s.start).as_secs_f64() - s.paused_for;
        Some(t.max(0.0))
    }

    pub fn now(&self) -> Option<f64> {
        self.at(Instant::now())
    }

    /// Recording time so far (keeps counting from where it paused).
    pub fn elapsed(&self) -> f64 {
        let s = self.0.lock();
        let end = s.paused_at.unwrap_or_else(Instant::now);
        (end.saturating_duration_since(s.start).as_secs_f64() - s.paused_for).max(0.0)
    }

    /// Time starts now (sources warm up first, then the recording begins at 0).
    pub fn restart(&self) {
        let mut s = self.0.lock();
        s.start = Instant::now();
        s.paused_for = 0.0;
        s.paused_at = None;
    }

    pub fn pause(&self) {
        let mut s = self.0.lock();
        if s.paused_at.is_none() {
            s.paused_at = Some(Instant::now());
        }
    }

    pub fn resume(&self) {
        let mut s = self.0.lock();
        if let Some(p) = s.paused_at.take() {
            s.paused_for += p.elapsed().as_secs_f64();
        }
    }

    pub fn is_paused(&self) -> bool {
        self.0.lock().paused_at.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn pausing_shifts_time() {
        let clock = Clock::new();
        std::thread::sleep(Duration::from_millis(50));
        clock.pause();
        assert!(clock.now().is_none());
        let at_pause = clock.elapsed();
        std::thread::sleep(Duration::from_millis(80));
        clock.resume();
        let after = clock.now().unwrap();
        assert!((after - at_pause).abs() < 0.02, "{at_pause} → {after}");
    }
}
