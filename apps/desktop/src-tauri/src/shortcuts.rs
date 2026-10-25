//! Global keyboard shortcuts (work from any app): ⌥⇧L record/stop, ⌥⇧P pause,
//! ⌥⇧C discard, ⌥⇧U recorder.

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub fn install(app: &AppHandle) {
    let mods = Some(Modifiers::ALT | Modifiers::SHIFT);
    let bindings =
        [(Code::KeyL, "record"), (Code::KeyP, "pause"), (Code::KeyC, "discard"), (Code::KeyU, "launcher"), (Code::Digit4, "screenshot")];
    for (code, action) in bindings {
        let shortcut = Shortcut::new(mods, code);
        let result = app.global_shortcut().on_shortcut(shortcut, move |app, _, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if action == "launcher" {
                crate::tray::toggle_launcher(app, None);
            } else if action == "screenshot" {
                let _ = crate::screenshot::area_pick(app.clone(), "screenshot".into());
            } else {
                let _ = app.emit("shortcut", action);
            }
        });
        if let Err(e) = result {
            // Another app owns it; the menu still works.
            eprintln!("shortcut {action}: {e}");
        }
    }
}
