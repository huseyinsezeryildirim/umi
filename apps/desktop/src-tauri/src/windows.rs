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
pub const CONTROLS: Spec = Spec { view: "controls", size: (400.0, 64.0), transparent: true, focus: false };
pub const COUNTDOWN: Spec = Spec { view: "countdown", size: (240.0, 240.0), transparent: true, focus: false };
pub const SHOT: Spec = Spec { view: "shot", size: (1120.0, 760.0), transparent: false, focus: true };
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

/// Shows the window for `spec` (creating it the first time) at `at` (points), or a default
/// place for that view.
pub fn show(app: &AppHandle, spec: &Spec, at: Option<(f64, f64)>) -> tauri::Result<WebviewWindow> {
    let (origin, display) = main_display(app);
    let place = at.unwrap_or_else(|| match spec.view {
        "launcher" => (origin.x + display.width - spec.size.0 - 16.0, origin.y + 36.0),
        "bubble" => (origin.x + 40.0, origin.y + display.height - spec.size.1 - 60.0),
        "controls" => (origin.x + (display.width - spec.size.0) / 2.0, origin.y + display.height - spec.size.1 - 40.0),
        // Just under the menu bar, near the camera, so eyes stay close to the lens.
        "prompter" => (origin.x + (display.width - spec.size.0) / 2.0, origin.y + 34.0),
        "shot" => (origin.x + (display.width - spec.size.0) / 2.0, origin.y + (display.height - spec.size.1) / 2.0),
        _ => (origin.x + (display.width - spec.size.0) / 2.0, origin.y + (display.height - spec.size.1) / 2.0),
    });
    if let Some(w) = app.get_webview_window(spec.view) {
        w.set_position(LogicalPosition::new(place.0, place.1))?;
        w.show()?;
        if spec.focus {
            w.set_focus()?;
        }
        return Ok(w);
    }
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
        .focused(spec.focus)
        .build()?;
    Ok(window)
}

pub fn hide(app: &AppHandle, view: &str) {
    if let Some(w) = app.get_webview_window(view) {
        let _ = w.hide();
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
pub fn ink_set(app: AppHandle, drawing: bool, color: Option<String>) -> Result<(), String> {
    let window = match app.get_webview_window("ink") {
        Some(w) => w,
        None => {
            let (origin, display) = main_display(&app);
            WebviewWindowBuilder::new(&app, "ink", WebviewUrl::App("index.html?view=ink".into()))
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
                .map_err(|e| e.to_string())?
        }
    };
    window.set_ignore_cursor_events(!drawing).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    if drawing {
        let _ = window.set_focus();
    }
    let _ = app.emit("ink:mode", serde_json::json!({ "drawing": drawing, "color": color }));
    Ok(())
}

#[tauri::command]
pub fn window_show(app: AppHandle, view: String, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    let at = x.zip(y);
    match view.as_str() {
        "launcher" => show(&app, &LAUNCHER, at).map(|_| ()),
        "bubble" => show(&app, &BUBBLE, at).map(|_| ()),
        "controls" => show(&app, &CONTROLS, at).map(|_| ()),
        "prompter" => show(&app, &PROMPTER, at).map(|_| ()),
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

/// Resizes the calling window (bubble sizes, launcher pages).
#[tauri::command]
pub fn window_resize(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}
