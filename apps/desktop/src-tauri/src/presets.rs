//! Saved looks (style presets) in the app's config folder; one can be the default for new
//! recordings.

use crate::AppState;
use crate::editor::{EditorState, Op};
use std::path::PathBuf;
use tauri::State;
use umi_project::presets::{PresetLibrary, StylePreset};

/// The app's config folder (~/Library/Application Support/Umi, %APPDATA%\Umi, ~/.config/Umi).
pub fn config_folder() -> PathBuf {
    let folder = dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("Umi");
    let _ = std::fs::create_dir_all(&folder);
    folder
}

fn file() -> PathBuf {
    config_folder().join("presets.json")
}

pub fn load() -> PresetLibrary {
    std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn store(library: &PresetLibrary) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(library).map_err(|e| e.to_string())?;
    let tmp = file().with_extension("tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, file()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn presets_list() -> PresetLibrary {
    load()
}

/// Saves the editor's current look as a new preset.
#[tauri::command]
pub fn preset_save(state: State<'_, AppState>, id: String, name: String) -> Result<PresetLibrary, String> {
    let edit = state.editor(&id)?.state(None).edit;
    let mut library = load();
    library.presets.push(StylePreset::from_edit(name.trim(), &edit));
    store(&library)?;
    Ok(library)
}

#[tauri::command]
pub fn preset_apply(state: State<'_, AppState>, id: String, preset: uuid::Uuid) -> Result<EditorState, String> {
    let editor = state.editor(&id)?;
    let library = load();
    let p = library.presets.iter().find(|p| p.id == preset).ok_or("preset not found")?;
    let mut edit = editor.state(None).edit;
    p.apply(&mut edit);
    Ok(editor.apply(Op::SetEdit { edit: Box::new(edit) }))
}

#[tauri::command]
pub fn preset_delete(preset: uuid::Uuid) -> Result<PresetLibrary, String> {
    let mut library = load();
    library.presets.retain(|p| p.id != preset);
    if library.default_id == Some(preset) {
        library.default_id = None;
    }
    store(&library)?;
    Ok(library)
}

/// Makes a preset the look new recordings start with (`None` = the built-in look).
#[tauri::command]
pub fn preset_set_default(preset: Option<uuid::Uuid>) -> Result<PresetLibrary, String> {
    let mut library = load();
    library.default_id = preset.filter(|id| library.presets.iter().any(|p| p.id == *id));
    store(&library)?;
    Ok(library)
}
