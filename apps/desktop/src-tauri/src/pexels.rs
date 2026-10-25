//! Free stock photos from Pexels as backgrounds. People bring their own API key (free at
//! pexels.com/api); it lives in the OS keychain. Chosen photos are copied into the
//! recording, so projects stay self-contained. Pexels asks for credit, shown in the picker.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const API: &str = "https://api.pexels.com/v1";
const KEYCHAIN_SERVICE: &str = "cam.umi.pexels";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: u64,
    /// Small preview (≈350 px wide).
    pub thumb: String,
    /// Big enough for a 4K background.
    pub full: String,
    pub photographer: String,
    pub photographer_url: String,
    pub page_url: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub photos: Vec<Photo>,
    pub has_more: bool,
}

#[derive(Deserialize)]
struct RawPage {
    photos: Vec<RawPhoto>,
    next_page: Option<String>,
}

#[derive(Deserialize)]
struct RawPhoto {
    id: u64,
    url: String,
    photographer: String,
    photographer_url: String,
    avg_color: Option<String>,
    src: RawSrc,
}

#[derive(Deserialize)]
struct RawSrc {
    original: String,
    medium: String,
}

/// The saved key, or `UMI_PEXELS_KEY` (handy for development and tests).
pub fn key() -> Option<String> {
    std::env::var("UMI_PEXELS_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .or_else(|| keyring::Entry::new(KEYCHAIN_SERVICE, "api-key").ok()?.get_password().ok())
}

/// One page of photos: a search, or Pexels' curated picks without a query.
pub fn search(key: &str, query: &str, page: u32) -> Result<Page, String> {
    let query = query.trim();
    let url = if query.is_empty() {
        format!("{API}/curated?per_page=24&page={page}")
    } else {
        format!("{API}/search?query={}&orientation=landscape&size=large&per_page=24&page={page}", encode(query))
    };
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let mut response = agent.get(&url).header("Authorization", key).call().map_err(|e| format!("Couldn't reach Pexels: {e}"))?;
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err("Pexels didn't accept this API key.".into()),
        429 => return Err("Pexels' hourly limit is reached; try again later.".into()),
        s => return Err(format!("Pexels answered {s}.")),
    }
    let raw: RawPage = response.body_mut().read_json().map_err(|e| format!("Unexpected answer from Pexels: {e}"))?;
    Ok(Page {
        has_more: raw.next_page.is_some(),
        photos: raw
            .photos
            .into_iter()
            .map(|p| Photo {
                id: p.id,
                thumb: p.src.medium,
                full: format!("{}?auto=compress&cs=tinysrgb&w=3840", p.src.original),
                photographer: p.photographer,
                photographer_url: p.photographer_url,
                page_url: p.url,
                color: p.avg_color,
            })
            .collect(),
    })
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Downloads the photo into the recording as `background-pexels-<id>.jpg`; returns that name.
pub fn download(bundle: &std::path::Path, id: u64, url: &str) -> Result<String, String> {
    if !url.starts_with("https://images.pexels.com/") {
        return Err("not a Pexels photo".into());
    }
    let name = format!("background-pexels-{id}.jpg");
    let target = bundle.join(&name);
    if target.exists() {
        return Ok(name);
    }
    let mut response = ureq::get(url).call().map_err(|e| format!("Couldn't download the photo: {e}"))?;
    let bytes = response.body_mut().with_config().limit(40 * 1024 * 1024).read_to_vec().map_err(|e| e.to_string())?;
    let partial = target.with_extension("part");
    std::fs::write(&partial, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    Ok(name)
}

#[tauri::command]
pub fn pexels_status() -> bool {
    key().is_some()
}

/// Checks the key with a tiny search, then keeps it in the keychain.
#[tauri::command]
pub async fn pexels_connect(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        search(&key, "", 1)?;
        keyring::Entry::new(KEYCHAIN_SERVICE, "api-key").and_then(|e| e.set_password(&key)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pexels_disconnect() {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, "api-key") {
        let _ = entry.delete_credential();
    }
}

#[tauri::command]
pub async fn pexels_search(query: String, page: u32) -> Result<Page, String> {
    let key = key().ok_or("Add a Pexels API key first.")?;
    tauri::async_runtime::spawn_blocking(move || search(&key, &query, page.max(1))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pexels_use(bundle: PathBuf, id: u64, url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download(&bundle, id, &url)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_queries() {
        assert_eq!(encode("blue sky & sea"), "blue+sky+%26+sea");
        assert_eq!(encode("çay"), "%C3%A7ay");
    }

    /// Needs network and `UMI_PEXELS_KEY`.
    #[test]
    fn searches_and_downloads() {
        let Ok(key) = std::env::var("UMI_PEXELS_KEY") else { return };
        let page = search(&key, "mountains", 1).unwrap();
        assert!(page.photos.len() > 5 && page.has_more);
        let curated = search(&key, "", 1).unwrap();
        assert!(!curated.photos.is_empty());
        assert!(search("not-a-key", "sky", 1).unwrap_err().contains("didn't accept"));

        let dir = std::env::temp_dir().join("umi-pexels-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let photo = &page.photos[0];
        let name = download(&dir, photo.id, &photo.full).unwrap();
        let image = umi_render::raster::decode_image(&dir.join(&name), 4096).unwrap();
        assert!(image.width >= 1920, "{}", image.width);
        assert!(download(&dir, 1, "https://evil.example/x.jpg").is_err());
    }
}
