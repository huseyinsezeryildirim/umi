//! Global keyboard shortcuts (work from any app). Defaults: ⌥⇧L record/stop, ⌥⇧P pause,
//! ⌥⇧C discard, ⌥⇧D draw, ⌥⇧U recorder, ⌥⇧4 screenshot. People can change them; a shortcut another
//! app already owns is reported instead of silently failing.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const ACTIONS: [(&str, &str, &str); 6] = [
    ("record", "Start / stop recording", "Alt+Shift+L"),
    ("pause", "Pause / resume", "Alt+Shift+P"),
    ("discard", "Discard recording", "Alt+Shift+C"),
    ("draw", "Draw on screen while recording", "Alt+Shift+D"),
    ("launcher", "Show the recorder", "Alt+Shift+U"),
    ("screenshot", "Take a screenshot", "Alt+Shift+4"),
];

fn file() -> std::path::PathBuf {
    crate::presets::config_folder().join("shortcuts.json")
}

/// Action → accelerator ("Alt+Shift+L"); empty = off.
pub fn load() -> BTreeMap<String, String> {
    let saved: BTreeMap<String, String> = std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    ACTIONS.iter().map(|(a, _, d)| (a.to_string(), saved.get(*a).cloned().unwrap_or_else(|| d.to_string()))).collect()
}

fn run(app: &AppHandle, action: &str) {
    match action {
        "launcher" => crate::tray::toggle_launcher(app, None),
        "screenshot" => {
            let _ = crate::screenshot::area_pick(app.clone(), "screenshot".into());
        }
        other => {
            let _ = app.emit("shortcut", other);
        }
    }
}

/// Registers the saved shortcuts; returns the ones that couldn't be (owned by another app).
pub fn install(app: &AppHandle) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut failed = vec![];
    for (action, keys) in load() {
        if keys.is_empty() {
            continue;
        }
        let Ok(shortcut) = keys.parse::<Shortcut>() else {
            failed.push(action);
            continue;
        };
        let name = action.clone();
        let result = gs.on_shortcut(shortcut, move |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                run(app, &name);
            }
        });
        if result.is_err() {
            failed.push(action);
        }
    }
    failed
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRow {
    action: String,
    label: String,
    keys: String,
    default: String,
    /// Another app (or another Umi action) already uses these keys.
    conflict: bool,
}

#[tauri::command]
pub fn shortcuts_get(app: AppHandle) -> Vec<ShortcutRow> {
    let failed = install(&app);
    let saved = load();
    ACTIONS
        .iter()
        .map(|(a, label, d)| ShortcutRow {
            action: a.to_string(),
            label: label.to_string(),
            keys: saved.get(*a).cloned().unwrap_or_default(),
            default: d.to_string(),
            conflict: failed.contains(&a.to_string()),
        })
        .collect()
}

#[derive(Deserialize)]
pub struct ShortcutChange {
    action: String,
    keys: String,
}

/// Saves a new shortcut and re-registers everything; the answer marks conflicts.
#[tauri::command]
pub fn shortcuts_set(app: AppHandle, change: ShortcutChange) -> Result<Vec<ShortcutRow>, String> {
    let mut saved = load();
    if !change.keys.is_empty() {
        change.keys.parse::<Shortcut>().map_err(|e| format!("Not a shortcut: {e}"))?;
        // Two actions can't share keys: the other one gets cleared.
        for (a, k) in saved.iter_mut() {
            if *a != change.action && k.eq_ignore_ascii_case(&change.keys) {
                k.clear();
            }
        }
    }
    saved.insert(change.action, change.keys);
    std::fs::write(file(), serde_json::to_vec_pretty(&saved).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(shortcuts_get(app))
}
