//! Which window is in front: its app and title, read about once a second while recording so a
//! recording can be named after what was on screen. One code path (xcap) for macOS (needs the
//! screen recording permission for titles), Windows and Linux on X11; Wayland doesn't say which
//! window is in front, so there it's `None`.

pub struct FrontWindow {
    pub app: String,
    pub title: String,
}

pub fn front_window() -> Option<FrontWindow> {
    let me = std::process::id();
    xcap::Window::all()
        .ok()?
        .into_iter()
        .find(|w| w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.pid().is_ok_and(|p| p != me))
        .map(|w| FrontWindow { app: w.app_name().unwrap_or_default(), title: w.title().unwrap_or_default() })
}
