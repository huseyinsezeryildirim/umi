//! Team workspaces on Umi Cloud: create or join one with an invite code, see the team's
//! videos, and share styles (presets) with everyone.

use crate::share::client;
use umi_cloud::{Member, TeamPreset, TeamVideo, Workspace};

/// Runs a cloud call off the main thread.
async fn cloud<T: Send + 'static>(f: impl FnOnce(umi_cloud::Client) -> Result<T, umi_cloud::CloudError> + Send + 'static) -> Result<T, String> {
    let client = client()?;
    tauri::async_runtime::spawn_blocking(move || {
        f(client).map_err(|e| if e.needs_plan() { "Team workspaces need an Umi Cloud plan.".to_string() } else { e.to_string() })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn team_list() -> Result<Vec<Workspace>, String> {
    cloud(|c| c.workspaces()).await
}

#[tauri::command]
pub async fn team_create(name: String) -> Result<Workspace, String> {
    cloud(move |c| c.create_workspace(name.trim())).await
}

#[tauri::command]
pub async fn team_join(code: String) -> Result<Workspace, String> {
    cloud(move |c| c.join_workspace(&code)).await
}

#[derive(serde::Serialize)]
pub struct TeamDetail {
    workspace: Workspace,
    members: Vec<Member>,
}

#[tauri::command]
pub async fn team_detail(id: String) -> Result<TeamDetail, String> {
    cloud(move |c| c.workspace(&id).map(|(workspace, members)| TeamDetail { workspace, members })).await
}

#[tauri::command]
pub async fn team_rotate_invite(id: String) -> Result<Workspace, String> {
    cloud(move |c| c.rotate_invite(&id)).await
}

/// Removes a member (owner) or leaves (your own id).
#[tauri::command]
pub async fn team_remove_member(id: String, member: String) -> Result<(), String> {
    cloud(move |c| c.remove_member(&id, &member)).await
}

#[tauri::command]
pub async fn team_delete(id: String) -> Result<(), String> {
    cloud(move |c| c.delete_workspace(&id)).await
}

#[tauri::command]
pub async fn team_videos(id: String) -> Result<Vec<TeamVideo>, String> {
    cloud(move |c| c.team_videos(&id)).await
}

#[tauri::command]
pub async fn team_presets(id: String) -> Result<Vec<TeamPreset>, String> {
    cloud(move |c| c.team_presets(&id)).await
}

/// Shares one of your saved styles with the team (same id: sharing again updates it).
#[tauri::command]
pub async fn team_preset_share(id: String, preset: uuid::Uuid) -> Result<(), String> {
    let p = crate::presets::load().presets.into_iter().find(|p| p.id == preset).ok_or("That style no longer exists.")?;
    let edit = serde_json::to_value(&p).map_err(|e| e.to_string())?;
    cloud(move |c| c.share_preset(&id, &p.id.to_string().to_uppercase(), &p.name, &edit)).await
}

/// Copies a team style into your own styles (replacing an older copy of it).
#[tauri::command]
pub fn team_preset_save(preset: TeamPreset) -> Result<umi_project::presets::PresetLibrary, String> {
    let mut style: umi_project::presets::StylePreset =
        serde_json::from_value(preset.edit).map_err(|e| format!("This style was made by a newer Umi: {e}"))?;
    style.name = preset.name;
    crate::presets::upsert(style)
}

#[tauri::command]
pub async fn team_preset_delete(id: String, preset: String) -> Result<(), String> {
    cloud(move |c| c.delete_preset(&id, &preset)).await
}
