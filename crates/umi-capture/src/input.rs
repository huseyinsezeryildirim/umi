//! Pointer and keyboard while recording: cursor positions (for Umi's own smooth cursor),
//! clicks (zooms, click rings, click sounds) and key presses (keystroke overlay, smart
//! zoom). Polled at 120 Hz, so it can always be stopped and needs no event hooks.
//!
//! On macOS the pointer needs no permission; keys are only seen with Input Monitoring
//! allowed (otherwise none are recorded).

use crate::Clock;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use umi_project::project::{CursorClick, CursorData, CursorMove, KeyPress, MouseButton};

/// The recorded area in global points (top-left origin); positions are stored relative to it.
#[derive(Debug, Clone, Copy)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Keys as shown on screen; modifiers come first in Apple's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Modifier {
    Control,
    Option,
    Shift,
    Command,
}

impl Modifier {
    pub fn symbol(self) -> &'static str {
        match (self, cfg!(target_os = "macos")) {
            (Modifier::Control, true) => "⌃",
            (Modifier::Option, true) => "⌥",
            (Modifier::Shift, _) => "⇧",
            (Modifier::Command, true) => "⌘",
            (Modifier::Control, false) => "Ctrl",
            (Modifier::Option, false) => "Alt",
            (Modifier::Command, false) => "Win",
        }
    }
}

/// One poll of the devices.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    /// Pointer in global points.
    pub pointer: (f64, f64),
    pub left: bool,
    pub right: bool,
    /// Non-modifier keys held, as labels ("A", "Return", "←").
    pub keys: Vec<&'static str>,
    pub modifiers: Vec<Modifier>,
}

#[cfg(target_os = "macos")]
fn poll() -> Snapshot {
    use readkey::Keycode as K;
    use readmouse::Mouse;
    const KEYS: &[(K, &str)] = &[
        (K::A, "A"), (K::B, "B"), (K::C, "C"), (K::D, "D"), (K::E, "E"), (K::F, "F"), (K::G, "G"), (K::H, "H"), (K::I, "I"), (K::J, "J"),
        (K::K, "K"), (K::L, "L"), (K::M, "M"), (K::N, "N"), (K::O, "O"), (K::P, "P"), (K::Q, "Q"), (K::R, "R"), (K::S, "S"), (K::T, "T"),
        (K::U, "U"), (K::V, "V"), (K::W, "W"), (K::X, "X"), (K::Y, "Y"), (K::Z, "Z"),
        (K::_0, "0"), (K::_1, "1"), (K::_2, "2"), (K::_3, "3"), (K::_4, "4"), (K::_5, "5"), (K::_6, "6"), (K::_7, "7"), (K::_8, "8"), (K::_9, "9"),
        (K::Return, "Return"), (K::Tab, "Tab"), (K::Space, "Space"), (K::Delete, "⌫"), (K::ForwardDelete, "⌦"), (K::Escape, "Esc"),
        (K::Left, "←"), (K::Right, "→"), (K::Up, "↑"), (K::Down, "↓"), (K::Home, "Home"), (K::End, "End"), (K::PageUp, "Page Up"), (K::PageDown, "Page Down"),
        (K::Minus, "-"), (K::Equal, "="), (K::LeftBracket, "["), (K::RightBracket, "]"), (K::Semicolon, ";"), (K::Quote, "'"), (K::Comma, ","), (K::Period, "."),
        (K::Slash, "/"), (K::Backslash, "\\"), (K::Grave, "`"),
        (K::F1, "F1"), (K::F2, "F2"), (K::F3, "F3"), (K::F4, "F4"), (K::F5, "F5"), (K::F6, "F6"), (K::F7, "F7"), (K::F8, "F8"), (K::F9, "F9"), (K::F10, "F10"), (K::F11, "F11"), (K::F12, "F12"),
    ];
    let mut modifiers = vec![];
    if K::Control.is_pressed() || K::RightControl.is_pressed() {
        modifiers.push(Modifier::Control);
    }
    if K::Option.is_pressed() || K::RightOption.is_pressed() {
        modifiers.push(Modifier::Option);
    }
    if K::Shift.is_pressed() || K::RightShift.is_pressed() {
        modifiers.push(Modifier::Shift);
    }
    if K::Command.is_pressed() || K::RightCommand.is_pressed() {
        modifiers.push(Modifier::Command);
    }
    Snapshot {
        pointer: Mouse::location(),
        left: Mouse::Left.is_pressed(),
        right: Mouse::Right.is_pressed(),
        keys: KEYS.iter().filter(|(k, _)| k.is_pressed()).map(|(_, l)| *l).collect(),
        modifiers,
    }
}

#[cfg(not(target_os = "macos"))]
fn poll() -> Snapshot {
    use device_query::{DeviceQuery, DeviceState, Keycode as K};
    thread_local!(static STATE: DeviceState = DeviceState::new());
    STATE.with(|state| {
        let mouse = state.get_mouse();
        let pressed = state.get_keys();
        let mut modifiers = vec![];
        let has = |k: K| pressed.contains(&k);
        if has(K::LControl) || has(K::RControl) {
            modifiers.push(Modifier::Control);
        }
        if has(K::LAlt) || has(K::RAlt) || has(K::LOption) || has(K::ROption) {
            modifiers.push(Modifier::Option);
        }
        if has(K::LShift) || has(K::RShift) {
            modifiers.push(Modifier::Shift);
        }
        if has(K::LMeta) || has(K::RMeta) || has(K::Command) || has(K::RCommand) {
            modifiers.push(Modifier::Command);
        }
        let keys = pressed.iter().filter_map(|k| label(*k)).collect();
        Snapshot { pointer: (mouse.coords.0 as f64, mouse.coords.1 as f64), left: mouse.button_pressed.get(1).copied().unwrap_or(false), right: mouse.button_pressed.get(3).copied().unwrap_or(false) || mouse.button_pressed.get(2).copied().unwrap_or(false), keys, modifiers }
    })
}

#[cfg(not(target_os = "macos"))]
fn label(k: device_query::Keycode) -> Option<&'static str> {
    use device_query::Keycode as K;
    Some(match k {
        K::A => "A", K::B => "B", K::C => "C", K::D => "D", K::E => "E", K::F => "F", K::G => "G", K::H => "H", K::I => "I", K::J => "J",
        K::K => "K", K::L => "L", K::M => "M", K::N => "N", K::O => "O", K::P => "P", K::Q => "Q", K::R => "R", K::S => "S", K::T => "T",
        K::U => "U", K::V => "V", K::W => "W", K::X => "X", K::Y => "Y", K::Z => "Z",
        K::Key0 => "0", K::Key1 => "1", K::Key2 => "2", K::Key3 => "3", K::Key4 => "4", K::Key5 => "5", K::Key6 => "6", K::Key7 => "7", K::Key8 => "8", K::Key9 => "9",
        K::Enter => "Enter", K::Tab => "Tab", K::Space => "Space", K::Backspace => "⌫", K::Delete => "Del", K::Escape => "Esc",
        K::Left => "←", K::Right => "→", K::Up => "↑", K::Down => "↓", K::Home => "Home", K::End => "End", K::PageUp => "Page Up", K::PageDown => "Page Down",
        K::Minus => "-", K::Equal => "=", K::LeftBracket => "[", K::RightBracket => "]", K::Semicolon => ";", K::Apostrophe => "'", K::Comma => ",", K::Dot => ".",
        K::Slash => "/", K::BackSlash => "\\", K::Grave => "`",
        K::F1 => "F1", K::F2 => "F2", K::F3 => "F3", K::F4 => "F4", K::F5 => "F5", K::F6 => "F6", K::F7 => "F7", K::F8 => "F8", K::F9 => "F9", K::F10 => "F10", K::F11 => "F11", K::F12 => "F12",
        _ => return None,
    })
}

/// Turns a stream of snapshots into cursor data (pure, so it's testable).
pub struct Tracker {
    area: Area,
    data: CursorData,
    last: Snapshot,
    last_move: Option<(f64, f64)>,
}

impl Tracker {
    pub fn new(area: Area) -> Self {
        Self { area, data: CursorData::default(), last: Snapshot::default(), last_move: None }
    }

    pub fn set_area(&mut self, area: Area) {
        self.area = area;
    }

    fn normalized(&self, (x, y): (f64, f64)) -> (f64, f64) {
        ((x - self.area.x) / self.area.width.max(1.0), (y - self.area.y) / self.area.height.max(1.0))
    }

    pub fn feed(&mut self, s: Snapshot, t: f64) {
        let (x, y) = self.normalized(s.pointer);
        if self.last_move.is_none_or(|p| (p.0 - x).abs() > 1e-5 || (p.1 - y).abs() > 1e-5) {
            self.data.moves.push(CursorMove { t, x, y });
            self.last_move = Some((x, y));
        }
        if s.left && !self.last.left {
            self.data.clicks.push(CursorClick { t, x, y, button: MouseButton::Left });
        }
        if s.right && !self.last.right {
            self.data.clicks.push(CursorClick { t, x, y, button: MouseButton::Right });
        }
        for key in s.keys.iter().filter(|k| !self.last.keys.contains(k)) {
            let shifted = s.modifiers == [Modifier::Shift];
            // Typed letters as typed (lowercase unless Shift); other keys by name.
            let label = if key.len() == 1 && key.chars().all(|c| c.is_ascii_alphabetic()) && !shifted && s.modifiers.is_empty() { key.to_lowercase() } else { (*key).to_string() };
            self.data.keys.push(KeyPress { t, key: label, modifiers: s.modifiers.iter().map(|m| m.symbol().to_string()).collect() });
        }
        self.last = s;
    }

    pub fn finish(self) -> CursorData {
        self.data
    }
}

/// Records pointer and keys until stopped.
pub struct InputRecorder {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<CursorData>>,
    area: Arc<parking_lot::Mutex<Area>>,
}

impl InputRecorder {
    pub fn start(clock: Clock, area: Area) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let shared = Arc::new(parking_lot::Mutex::new(area));
        let (flag, area_ref) = (stop.clone(), shared.clone());
        let thread = std::thread::Builder::new()
            .name("umi-input".into())
            .spawn(move || {
                let mut tracker = Tracker::new(area);
                let period = Duration::from_micros(8_333);
                let mut next = Instant::now();
                while !flag.load(Ordering::Relaxed) {
                    tracker.set_area(*area_ref.lock());
                    if let Some(t) = clock.now() {
                        tracker.feed(poll(), t);
                    }
                    next += period;
                    let now = Instant::now();
                    if next > now {
                        std::thread::sleep(next - now);
                    } else {
                        next = now;
                    }
                }
                tracker.finish()
            })
            .ok();
        Self { stop, thread, area: shared }
    }

    /// The recorded area moved (e.g. a window being recorded).
    pub fn set_area(&self, area: Area) {
        *self.area.lock() = area;
    }

    pub fn stop(mut self) -> CursorData {
        self.stop.store(true, Ordering::Relaxed);
        self.thread.take().and_then(|t| t.join().ok()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(x: f64, y: f64, left: bool, keys: &[&'static str], modifiers: &[Modifier]) -> Snapshot {
        Snapshot { pointer: (x, y), left, right: false, keys: keys.to_vec(), modifiers: modifiers.to_vec() }
    }

    #[test]
    fn records_moves_clicks_and_keys() {
        let mut t = Tracker::new(Area { x: 100.0, y: 50.0, width: 800.0, height: 600.0 });
        t.feed(snap(500.0, 350.0, false, &[], &[]), 0.0);
        t.feed(snap(500.0, 350.0, false, &[], &[]), 0.01); // no move: not stored
        t.feed(snap(900.0, 650.0, true, &[], &[]), 0.02);
        t.feed(snap(900.0, 650.0, true, &[], &[]), 0.03); // held: one click
        t.feed(snap(900.0, 650.0, false, &["H"], &[]), 0.04);
        t.feed(snap(900.0, 650.0, false, &["H", "I"], &[]), 0.05);
        t.feed(snap(900.0, 650.0, false, &["K"], &[Modifier::Shift, Modifier::Command]), 0.06);
        let d = t.finish();
        assert_eq!(d.moves.len(), 2);
        assert!((d.moves[0].x - 0.5).abs() < 1e-9 && (d.moves[0].y - 0.5).abs() < 1e-9);
        assert_eq!(d.clicks.len(), 1);
        assert!((d.clicks[0].x - 1.0).abs() < 1e-9);
        let keys: Vec<(String, Vec<String>)> = d.keys.iter().map(|k| (k.key.clone(), k.modifiers.clone())).collect();
        assert_eq!(keys[0], ("h".to_string(), vec![]));
        assert_eq!(keys[1], ("i".to_string(), vec![]));
        assert_eq!(keys[2].0, "K");
        assert_eq!(keys[2].1.len(), 2);
    }
}
