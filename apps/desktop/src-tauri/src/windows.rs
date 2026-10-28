//! The app's small windows around recording. They all load the same UI with a `view`
//! query (launcher, bubble, controls, countdown, area) and float above other apps.

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub struct Spec {
    pub view: &'static str,
    pub size: (f64, f64),
    pub transparent: bool,
    pub focus: bool,
}

pub const LAUNCHER: Spec = Spec { view: "launcher", size: (360.0, 560.0), transparent: true, focus: true };
pub const BUBBLE: Spec = Spec { view: "bubble", size: (240.0, 240.0), transparent: true, focus: false };
/// A column on the left, like Loom's: stop, time, sound, pen, pause, start over, discard.
pub const CONTROLS: Spec = Spec { view: "controls", size: (72.0, 410.0), transparent: true, focus: false };
/// The layout column on the right while recording: screen and bubble, side by side, camera
/// only, screen only. Left out of the video like every Umi window.
pub const LAYOUTS: Spec = Spec { view: "layouts", size: (64.0, 236.0), transparent: true, focus: false };
/// The drawing tools along the bottom while recording (pen, highlighter, arrow, box, spotlight,
/// colors, undo, clear, keep). Left out of the video; what's drawn (the ink layer) is in it.
/// Small until the pointer comes near; then it grows to all the tools (Draw.tsx).
pub const DRAW: Spec = Spec { view: "draw", size: (120.0, 56.0), transparent: true, focus: false };
pub const COUNTDOWN: Spec = Spec { view: "countdown", size: (240.0, 240.0), transparent: true, focus: false };
pub const SHOT: Spec = Spec { view: "shot", size: (1120.0, 760.0), transparent: false, focus: true };
/// The camera menu, opened from the bubble's adjust button, next to the bubble.
pub const CAMERA_MENU: Spec = Spec { view: "camera", size: (280.0, 300.0), transparent: true, focus: true };
pub const PROMPTER: Spec = Spec { view: "prompter", size: (520.0, 220.0), transparent: true, focus: true };

/// The main display's frame in points (position, size).
fn main_display(app: &AppHandle) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let s = m.scale_factor();
            (
                LogicalPosition::new(m.position().x as f64 / s, m.position().y as f64 / s),
                LogicalSize::new(m.size().width as f64 / s, m.size().height as f64 / s),
            )
        })
        .unwrap_or((LogicalPosition::new(0.0, 0.0), LogicalSize::new(1440.0, 900.0)))
}

/// Where the drawing tools go: centered, just above the Dock (or the taskbar), whose clicks
/// would otherwise win over the panel's.
fn draw_place(app: &AppHandle) -> (f64, f64) {
    let (origin, display) = main_display(app);
    let bottom = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let a = m.work_area();
            (a.position.y as f64 + a.size.height as f64) / m.scale_factor()
        })
        .unwrap_or(origin.y + display.height);
    (origin.x + (display.width - DRAW.size.0) / 2.0, bottom - DRAW.size.1 - 28.0)
}

/// Shows the window for `spec` (creating it the first time) at `at` (points), or a default
/// place for that view.
pub fn show(app: &AppHandle, spec: &Spec, at: Option<(f64, f64)>) -> tauri::Result<WebviewWindow> {
    let window = show_window(app, spec, at)?;
    // Recording: keep the window that just appeared out of the video.
    if spec.transparent {
        let app = app.clone();
        std::thread::spawn(move || {
            // Once it's really on screen.
            std::thread::sleep(std::time::Duration::from_millis(250));
            if let Some(r) = app.state::<crate::AppState>().recorder.current.lock().as_ref() {
                r.refresh_exclusions();
            }
        });
    }
    Ok(window)
}

fn show_window(app: &AppHandle, spec: &Spec, at: Option<(f64, f64)>) -> tauri::Result<WebviewWindow> {
    let (origin, display) = main_display(app);
    // The countdown dims the whole screen.
    let full = Spec { view: spec.view, size: (display.width, display.height), transparent: spec.transparent, focus: spec.focus };
    let spec = if spec.view == "countdown" { &full } else { spec };
    let place = at.unwrap_or_else(|| match spec.view {
        "launcher" => (origin.x + display.width - spec.size.0 - 16.0, origin.y + 36.0),
        "bubble" => (origin.x + 40.0, origin.y + display.height - spec.size.1 - 60.0),
        "controls" => (origin.x + 16.0, origin.y + (display.height - spec.size.1) / 2.0),
        "layouts" => (origin.x + display.width - spec.size.0 - 16.0, origin.y + (display.height - spec.size.1) / 2.0),
        "draw" => draw_place(app),
        // Just under the menu bar, near the camera, so eyes stay close to the lens.
        "prompter" => (origin.x + (display.width - spec.size.0) / 2.0, origin.y + 34.0),
        "countdown" => (origin.x, origin.y),
        "shot" => (origin.x + (display.width - spec.size.0) / 2.0, origin.y + (display.height - spec.size.1) / 2.0),
        _ => (origin.x + (display.width - spec.size.0) / 2.0, origin.y + (display.height - spec.size.1) / 2.0),
    });
    if let Some(w) = app.get_webview_window(spec.view) {
        // The bubble comes back where it was dragged to.
        if spec.view != "bubble" || at.is_some() {
            w.set_position(LogicalPosition::new(place.0, place.1))?;
        }
        w.show()?;
        // The bubble turned its camera off when hidden; it starts it again.
        if spec.view == "bubble" {
            let _ = w.emit("bubble:shown", ());
        }
        if spec.focus {
            w.set_focus()?;
        }
        return Ok(w);
    }
    let window = build(app, spec, place, true)?;
    Ok(window)
}

/// Makes a window for `spec` at `place`, shown or not.
fn build(app: &AppHandle, spec: &Spec, place: (f64, f64), visible: bool) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, spec.view, WebviewUrl::App(format!("index.html?view={}", spec.view).into()))
        .title("Umi")
        .inner_size(spec.size.0, spec.size.1)
        .position(place.0, place.1)
        .decorations(!spec.transparent)
        .transparent(spec.transparent)
        .always_on_top(spec.transparent)
        .resizable(!spec.transparent)
        .skip_taskbar(spec.transparent)
        .shadow(!spec.transparent)
        .visible_on_all_workspaces(true)
        .focused(spec.focus && visible)
        // A click on the bar or the bubble works at once (not just brings the window forward).
        .accept_first_mouse(spec.transparent)
        .visible(visible)
        .build()?;
    if spec.transparent {
        float_over_full_screen(&window, 25);
        keep_out_of_recordings(&window);
    }
    Ok(window)
}

/// Windows: the floating windows (bar, bubble, menus, countdown) never show in a recording,
/// from the moment they exist (the drawing layer is made elsewhere and stays recordable).
/// macOS leaves them out through the capture's filter instead (see umi-capture).
#[allow(unsafe_code)]
fn keep_out_of_recordings(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};
        // SAFETY: a valid window handle owned by this window (Windows 10 2004+; older
        // versions just ignore the flag).
        unsafe {
            SetWindowDisplayAffinity(hwnd.0 as _, WDA_EXCLUDEFROMCAPTURE);
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// The floating windows (bubble, control bar, countdown, prompter) stay visible when another
/// app is full screen: macOS shows a window in a full-screen Space only when it's marked as a
/// full-screen auxiliary and sits above normal windows.
#[allow(unexpected_cfgs, unsafe_code)]
/// `level` 25 is NSStatusWindowLevel (above other apps' windows); the drawing layer goes one
/// below, so the bubble and the control bar stay on top of it.
pub fn float_over_full_screen(window: &WebviewWindow, level: isize) {
    #[cfg(target_os = "macos")]
    {
        use objc::{msg_send, sel, sel_impl};
        // canJoinAllSpaces | stationary | fullScreenAuxiliary
        let behavior: usize = (1 << 0) | (1 << 4) | (1 << 8);
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Ok(ns_window) = w.ns_window() else { return };
            let ns_window = ns_window as *mut objc::runtime::Object;
            // SAFETY: this window's own NSWindow, on the main thread.
            unsafe {
                let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
                let _: () = msg_send![ns_window, setLevel: level];
            }
        });
    }
}

/// Makes the windows that show up while recording (countdown, control bar, layouts, drawing tools, camera menu) now,
/// unseen: the countdown shows the moment Start is pressed (a window's first load takes a
/// moment), and the recording leaves them out from its first frame (they already exist).
pub fn prepare_recording_windows(app: &AppHandle) {
    let (origin, display) = main_display(app);
    let countdown = Spec { view: "countdown", size: (display.width, display.height), transparent: true, focus: false };
    for (spec, place) in [
        (&countdown, (origin.x, origin.y)),
        (&CONTROLS, (origin.x + 16.0, origin.y + (display.height - CONTROLS.size.1) / 2.0)),
        (&LAYOUTS, (origin.x + display.width - LAYOUTS.size.0 - 16.0, origin.y + (display.height - LAYOUTS.size.1) / 2.0)),
        (&DRAW, draw_place(app)),
        (&CAMERA_MENU, (origin.x + 16.0, origin.y + 40.0)),
    ] {
        if app.get_webview_window(spec.view).is_none() {
            if let Ok(w) = build(app, spec, place, false) {
                if spec.view == "countdown" {
                    let _ = w.set_ignore_cursor_events(true);
                }
            }
        }
    }
}

/// The recorder, with the camera bubble when the camera was left on.
pub fn show_launcher(app: &AppHandle, at: Option<(f64, f64)>) -> tauri::Result<WebviewWindow> {
    prepare_recording_windows(app);
    let window = show(app, &LAUNCHER, at)?;
    let settings = crate::recording::load_settings();
    if settings.camera_on || settings.camera_only {
        show(app, &BUBBLE, None)?;
    }
    Ok(window)
}

pub fn hide(app: &AppHandle, view: &str) {
    if let Some(w) = app.get_webview_window(view) {
        let _ = w.hide();
    }
    // No camera light for a bubble nobody sees.
    if view == "bubble" {
        crate::recording::stop_preview(app);
    }
}

/// Full-screen, see-through overlay on the main display for picking an area.
pub fn show_area_picker(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let (origin, display) = main_display(app);
    if let Some(w) = app.get_webview_window("area") {
        w.show()?;
        w.set_focus()?;
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "area", WebviewUrl::App("index.html?view=area".into()))
        .title("Select an area")
        .inner_size(display.width, display.height)
        .position(origin.x, origin.y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .focused(true)
        .build()
}

/// The drawing layer over the main display. It's recorded (see `INK_WINDOW_TITLE`); while
/// `drawing` it takes the mouse, otherwise clicks pass through to the apps below.
#[tauri::command]
pub fn ink_set(app: AppHandle, drawing: bool, color: Option<String>, tool: Option<String>) -> Result<(), String> {
    let window = match app.get_webview_window("ink") {
        Some(w) => w,
        None => {
            let (origin, display) = main_display(&app);
            let w = WebviewWindowBuilder::new(&app, "ink", WebviewUrl::App("index.html?view=ink".into()))
                .title(umi_capture::screen::INK_WINDOW_TITLE)
                .inner_size(display.width, display.height)
                .position(origin.x, origin.y)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .resizable(false)
                .skip_taskbar(true)
                .shadow(false)
                .visible_on_all_workspaces(true)
                .focused(drawing)
                .build()
                .map_err(|e| e.to_string())?;
            float_over_full_screen(&w, 24);
            w
        }
    };
    window.set_ignore_cursor_events(!drawing).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    if drawing {
        let _ = window.set_focus();
    }
    let _ = app.emit("ink:mode", serde_json::json!({ "drawing": drawing, "color": color, "tool": tool }));
    Ok(())
}

static SPOTLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The spotlight follows the pointer while clicks still go to the apps below: the pointer's place
/// (in the ink layer's points) goes to the layer ~60 times a second until it's turned off.
#[tauri::command]
pub fn ink_spotlight(app: AppHandle, on: bool) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if on {
        ink_set(app.clone(), false, None, Some("spotlight".into()))?;
    }
    if SPOTLIGHT.swap(on, Ordering::SeqCst) == on || !on {
        return Ok(());
    }
    std::thread::spawn(move || {
        let mut last = (f64::NAN, f64::NAN);
        while SPOTLIGHT.load(Ordering::SeqCst) {
            if let (Some(ink), Ok(cursor)) = (app.get_webview_window("ink"), app.cursor_position())
                && let (Ok(pos), Ok(scale)) = (ink.outer_position(), ink.scale_factor())
            {
                let at = ((cursor.x - pos.x as f64) / scale, (cursor.y - pos.y as f64) / scale);
                if at != last {
                    last = at;
                    let _ = app.emit_to("ink", "ink:cursor", at);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
        let _ = app.emit_to("ink", "ink:cursor", serde_json::Value::Null);
    });
    Ok(())
}

#[tauri::command]
pub fn window_show(app: AppHandle, view: String, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    let at = x.zip(y);
    match view.as_str() {
        "launcher" => show_launcher(&app, at).map(|_| ()),
        "bubble" => show(&app, &BUBBLE, at).map(|_| ()),
        "controls" => show(&app, &CONTROLS, at).map(|_| ()),
        "layouts" => show(&app, &LAYOUTS, at).map(|_| ()),
        "draw" => show(&app, &DRAW, at).map(|_| ()),
        "prompter" => show(&app, &PROMPTER, at).map(|_| ()),
        "camera" => {
            // Beside the bubble: to its right, or its left near the screen's right edge.
            let place = app.get_webview_window("bubble").and_then(|b| {
                let scale = b.scale_factor().ok()?;
                let pos = b.outer_position().ok()?.to_logical::<f64>(scale);
                let size = b.outer_size().ok()?.to_logical::<f64>(scale);
                let (origin, display) = main_display(&app);
                let right = pos.x + size.width + 8.0;
                let x = if right + CAMERA_MENU.size.0 > origin.x + display.width { pos.x - CAMERA_MENU.size.0 - 8.0 } else { right };
                let y = (pos.y + size.height - CAMERA_MENU.size.1).max(origin.y + 30.0);
                Some((x, y))
            });
            show(&app, &CAMERA_MENU, at.or(place)).map(|_| ())
        }
        "shot" => show(&app, &SHOT, at).map(|_| ()),
        "countdown" => show(&app, &COUNTDOWN, at).map(|w| {
            let _ = w.set_ignore_cursor_events(true);
        }),
        "area" => show_area_picker(&app).map(|_| ()),
        "main" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            Ok(())
        }
        _ => return Err(format!("unknown view {view}")),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_hide(app: AppHandle, view: String) {
    hide(&app, &view);
}

/// Gives another app's window an exact size before recording it (macOS asks once for
/// permission to control other apps; Windows needs nothing).
#[tauri::command]
pub fn resize_app_window(app_name: String, title: String, width: f64, height: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "tell application \"System Events\"\n tell (first process whose name is \"{}\")\n  set size of (first window whose name is \"{}\") to {{{}, {}}}\n end tell\nend tell",
            esc(&app_name),
            esc(&title),
            width.round() as i64,
            height.round() as i64
        );
        let out = std::process::Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!("Couldn't resize: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app_name, title, width, height);
        Err("Resizing other windows isn't available on this system yet.".into())
    }
}

/// Resizes the calling window (bubble sizes, launcher pages). `grow: "up"` keeps its bottom
/// edge and horizontal center where they are (the drawing tools opening and closing).
#[tauri::command]
pub fn window_resize(window: tauri::WebviewWindow, width: f64, height: f64, grow: Option<String>) -> Result<(), String> {
    if grow.as_deref() == Some("up") {
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let pos = window.outer_position().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
        let size = window.outer_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
        let (x, y) = (pos.x + (size.width - width) / 2.0, pos.y + size.height - height);
        window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        return window.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string());
    }
    window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}
