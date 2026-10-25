//! The menu bar / system tray icon: click for the launcher, right-click for a menu.

use crate::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "record", "Start or stop recording", true, Some("Alt+Shift+L"))?,
            &MenuItem::with_id(app, "pause", "Pause or resume", true, Some("Alt+Shift+P"))?,
            &MenuItem::with_id(app, "discard", "Discard recording", true, Some("Alt+Shift+C"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "launcher", "Show recorder", true, Some("Alt+Shift+U"))?,
            &MenuItem::with_id(app, "library", "Open library", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Umi", true, None::<&str>)?,
        ],
    )?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("umi")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Umi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "library" => {
                let _ = crate::windows::window_show(app.clone(), "main".into(), None, None);
            }
            "launcher" => toggle_launcher(app, None),
            id => {
                let _ = app.emit("shortcut", id);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                let app = tray.app_handle();
                // While recording, a click stops; otherwise it opens the launcher under the icon.
                if app.state::<AppState>().recorder.current.lock().is_some() {
                    let _ = app.emit("shortcut", "record");
                    return;
                }
                let scale = app.primary_monitor().ok().flatten().map_or(1.0, |m| m.scale_factor());
                let pos = rect.position.to_logical::<f64>(scale);
                let size = rect.size.to_logical::<f64>(scale);
                toggle_launcher(app, Some((pos.x + size.width / 2.0 - crate::windows::LAUNCHER.size.0 / 2.0, pos.y + size.height + 6.0)));
            }
        })
        .build(app)?;
    Ok(())
}

pub fn toggle_launcher(app: &AppHandle, at: Option<(f64, f64)>) {
    if let Some(w) = app.get_webview_window("launcher")
        && w.is_visible().unwrap_or(false)
    {
        let _ = w.hide();
        return;
    }
    let _ = crate::windows::show(app, &crate::windows::LAUNCHER, at);
}
