//! Talks to Umi Cloud (see `web/README.md`): videos are created first (so the link exists
//! and can be copied right away), then uploaded in parts straight to storage, then
//! completed. The link's settings (password, expiry, downloads, comments) can change later.

use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, thiserror::Error)]
pub enum CloudError {
    #[error("{message}")]
    Server { status: u16, code: String, message: String },
    #[error("Couldn't reach Umi Cloud: {0}")]
    Network(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    /// The file being uploaded couldn't be finished (e.g. its export failed).
    #[error("{0}")]
    Aborted(String),
}

impl CloudError {
    /// The account needs a plan for cloud sharing.
    pub fn needs_plan(&self) -> bool {
        matches!(self, CloudError::Server { status: 402, .. })
    }
    pub fn unauthorized(&self) -> bool {
        matches!(self, CloudError::Server { status: 401, .. })
    }
}

/// A shared video as the server describes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub url: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub allow_download: bool,
    #[serde(default)]
    pub has_password: bool,
    #[serde(default)]
    pub allow_comments: Option<bool>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub expired: Option<bool>,
    /// The team workspace it's shared with.
    #[serde(default)]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Part {
    part_number: u32,
    url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadPlan {
    part_size: u64,
    parts: Vec<Part>,
    #[serde(default)]
    thumbnail_url: Option<String>,
    #[serde(default)]
    gif_url: Option<String>,
}

#[derive(Deserialize)]
struct Created {
    video: Video,
    upload: UploadPlan,
}

#[derive(Deserialize)]
struct VideoBody {
    video: Video,
}

/// Link settings to change; `None` leaves a setting as it is.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_download: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_comments: Option<bool>,
    /// "" removes the password.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// `Some(None)` removes the expiry; ISO 8601 date otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<Option<String>>,
    /// `Some(None)` takes it out of its workspace.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<Option<String>>,
}

/// What's being uploaded, for the progress bar.
pub struct Media<'a> {
    pub video: &'a Path,
    pub title: String,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub poster: Option<Vec<u8>>,
    pub gif: Option<Vec<u8>>,
}

/// What viewers did with a shared video (Umi Cloud).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub views: u64,
    pub watched_seconds: u64,
    pub average_seconds: u64,
    /// Share of viewers who reached the end, 0…1.
    pub completion: f64,
    /// Share of viewers who saw each twentieth of the video.
    pub retention: Vec<f64>,
    #[serde(default)]
    pub embedded_views: u64,
    #[serde(default)]
    pub countries: Vec<Country>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Country {
    pub country: String,
    pub count: u64,
}

/// A link made before its video exists (Instant mode copies it the moment recording stops).
#[derive(Debug, Clone)]
pub struct Reservation {
    pub video: Video,
    upload: UploadPlan,
}

/// What's known once the growing file is finished.
pub struct Finished {
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub poster: Option<Vec<u8>>,
    pub gif: Option<Vec<u8>>,
}

pub struct Client {
    pub base: String,
    token: String,
}

impl Client {
    pub fn new(base: &str, token: &str) -> Self {
        Self { base: base.trim_end_matches('/').to_string(), token: token.to_string() }
    }

    fn agent() -> ureq::Agent {
        ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(std::time::Duration::from_secs(600))).build().into()
    }

    fn read<T: serde::de::DeserializeOwned>(mut response: ureq::http::Response<ureq::Body>) -> Result<T, CloudError> {
        let status = response.status().as_u16();
        let text = response.body_mut().read_to_string().map_err(|e| CloudError::Network(e.to_string()))?;
        if (200..300).contains(&status) {
            return serde_json::from_str(&text).map_err(|e| CloudError::Network(format!("unexpected answer: {e}")));
        }
        #[derive(Deserialize)]
        struct Inner {
            code: String,
            message: String,
        }
        #[derive(Deserialize)]
        struct Body {
            error: Inner,
        }
        let (code, message) = serde_json::from_str::<Body>(&text)
            .map(|b| (b.error.code, b.error.message))
            .unwrap_or_else(|_| ("http".into(), format!("Umi Cloud answered {status}.")));
        Err(CloudError::Server { status, code, message })
    }

    fn send<T: serde::de::DeserializeOwned>(&self, method: &str, path: &str, body: Option<serde_json::Value>) -> Result<T, CloudError> {
        let url = format!("{}{path}", self.base);
        let auth = format!("Bearer {}", self.token);
        let agent = Self::agent();
        let net = |e: ureq::Error| CloudError::Network(e.to_string());
        let response = match (method, body) {
            ("GET", _) => agent.get(&url).header("Authorization", &auth).call().map_err(net)?,
            ("DELETE", _) => agent.delete(&url).header("Authorization", &auth).call().map_err(net)?,
            ("PATCH", Some(b)) => agent.patch(&url).header("Authorization", &auth).send_json(b).map_err(net)?,
            ("PUT", Some(b)) => agent.put(&url).header("Authorization", &auth).send_json(b).map_err(net)?,
            (_, b) => agent.post(&url).header("Authorization", &auth).send_json(b.unwrap_or(serde_json::json!({}))).map_err(net)?,
        };
        Self::read(response)
    }

    /// Checks the token (lists videos).
    pub fn check(&self) -> Result<(), CloudError> {
        self.send::<serde_json::Value>("GET", "/api/videos", None).map(|_| ())
    }

    pub fn video(&self, id: &str) -> Result<Video, CloudError> {
        Ok(self.send::<VideoBody>("GET", &format!("/api/videos/{id}"), None)?.video)
    }

    pub fn update(&self, id: &str, settings: &Settings) -> Result<Video, CloudError> {
        Ok(self.send::<VideoBody>("PATCH", &format!("/api/videos/{id}"), Some(serde_json::to_value(settings).unwrap_or_default()))?.video)
    }

    pub fn insights(&self, id: &str) -> Result<Insights, CloudError> {
        self.send("GET", &format!("/api/videos/{id}/insights"), None)
    }

    pub fn delete(&self, id: &str) -> Result<(), CloudError> {
        self.send::<serde_json::Value>("DELETE", &format!("/api/videos/{id}"), None).map(|_| ())
    }

    fn put(url: &str, bytes: &[u8], content_type: &str) -> Result<String, CloudError> {
        let mut last = None;
        // Three tries with a short pause: flaky networks shouldn't fail a long upload.
        for attempt in 0..3 {
            if attempt > 0 {
                std::thread::sleep(std::time::Duration::from_millis(600 * attempt));
            }
            match Self::agent().put(url).header("Content-Type", content_type).send(bytes) {
                Ok(r) if r.status().is_success() => {
                    return Ok(r.headers().get("etag").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string());
                }
                Ok(r) => {
                    last = Some(CloudError::Server {
                        status: r.status().as_u16(),
                        code: "upload_failed".into(),
                        message: "Upload failed. Check your connection and try again.".into(),
                    })
                }
                Err(e) => last = Some(CloudError::Network(e.to_string())),
            }
        }
        Err(last.unwrap_or_else(|| CloudError::Network("upload failed".into())))
    }

    /// Creates the link (`on_link` gets it at once, to copy) and uploads everything.
    /// `progress` gets 0…1.
    pub fn share(&self, media: &Media, on_link: &dyn Fn(&Video), progress: &(dyn Fn(f64) + Sync)) -> Result<Video, CloudError> {
        let size = std::fs::metadata(media.video)?.len();
        let created: Created = self.send(
            "POST",
            "/api/videos",
            Some(serde_json::json!({
                "title": media.title, "sizeBytes": size, "contentType": "video/mp4",
                "durationMs": media.duration_ms, "width": media.width, "height": media.height, "allowDownload": true,
            })),
        )?;
        on_link(&created.video);
        if let (Some(url), Some(jpeg)) = (&created.upload.thumbnail_url, &media.poster) {
            Self::put(url, jpeg, "image/jpeg")?;
        }
        if let (Some(url), Some(gif)) = (&created.upload.gif_url, &media.gif) {
            Self::put(url, gif, "image/gif")?;
        }
        // Video parts, three at a time.
        let parts = created.upload.parts.clone();
        let part_size = created.upload.part_size;
        let sent = AtomicU64::new(0);
        let etags = Mutex::new(Vec::<(u32, String)>::new());
        let next = Mutex::new(parts.into_iter());
        let failure = Mutex::new(None::<CloudError>);
        std::thread::scope(|scope| {
            for _ in 0..3 {
                scope.spawn(|| {
                    loop {
                        let Some(part) = next.lock().ok().and_then(|mut it| it.next()) else { return };
                        if failure.lock().map(|f| f.is_some()).unwrap_or(true) {
                            return;
                        }
                        let result = (|| -> Result<String, CloudError> {
                            let mut file = std::fs::File::open(media.video)?;
                            let offset = (part.part_number as u64 - 1) * part_size;
                            file.seek(SeekFrom::Start(offset))?;
                            let mut buf = Vec::with_capacity(part_size.min(size - offset) as usize);
                            file.take(part_size).read_to_end(&mut buf)?;
                            let etag = Self::put(&part.url, &buf, "video/mp4")?;
                            let done = sent.fetch_add(buf.len() as u64, Ordering::Relaxed) + buf.len() as u64;
                            progress(done as f64 / size.max(1) as f64 * 0.98);
                            Ok(etag)
                        })();
                        match result {
                            Ok(etag) => etags.lock().unwrap_or_else(|e| e.into_inner()).push((part.part_number, etag)),
                            Err(e) => {
                                *failure.lock().unwrap_or_else(|e| e.into_inner()) = Some(e);
                                return;
                            }
                        }
                    }
                });
            }
        });
        if let Some(e) = failure.into_inner().unwrap_or_else(|e| e.into_inner()) {
            return Err(e);
        }
        let mut etags = etags.into_inner().unwrap_or_else(|e| e.into_inner());
        etags.sort_by_key(|(n, _)| *n);
        let parts: Vec<serde_json::Value> = etags.iter().map(|(n, e)| serde_json::json!({ "partNumber": n, "etag": e })).collect();
        let done: VideoBody =
            self.send("POST", &format!("/api/videos/{}/complete", created.video.id), Some(serde_json::json!({ "parts": parts })))?;
        progress(1.0);
        Ok(done.video)
    }
}

impl Client {
    /// Creates the link now; the video comes later through [`upload_growing`](Self::upload_growing).
    /// The size isn't known yet, so it asks for room for a long video (the real size is
    /// recorded when the upload completes).
    pub fn reserve(&self, title: &str) -> Result<Reservation, CloudError> {
        let mut last = None;
        for hint in [4u64 << 30, 1 << 30, 256 << 20] {
            let body = serde_json::json!({ "title": title, "sizeBytes": hint, "contentType": "video/mp4", "allowDownload": true });
            match self.send::<Created>("POST", "/api/videos", Some(body)) {
                Ok(c) => return Ok(Reservation { video: c.video, upload: c.upload }),
                Err(e @ CloudError::Server { status: 413, .. }) => last = Some(e),
                Err(e) => return Err(e),
            }
        }
        Err(last.unwrap_or_else(|| CloudError::Network("couldn't reserve a link".into())))
    }

    /// Uploads `file` while it's still being written: whole parts go up as soon as they
    /// exist; once `finished` returns details, the rest follows and the upload completes
    /// (an error from `finished` stops it).
    /// The first part goes last (the MP4 writer patches its first bytes when it finishes).
    /// `progress` gets bytes sent so far.
    pub fn upload_growing(
        &self,
        reservation: &Reservation,
        file: &Path,
        finished: &dyn Fn() -> Option<Result<Finished, String>>,
        progress: &dyn Fn(u64),
    ) -> Result<Video, CloudError> {
        let plan = &reservation.upload;
        let part_size = plan.part_size;
        let url = |n: u32| -> Result<&str, CloudError> {
            plan.parts.iter().find(|p| p.part_number == n).map(|p| p.url.as_str()).ok_or_else(|| CloudError::Server {
                status: 413,
                code: "too_large".into(),
                message: "This recording is longer than one link can hold.".into(),
            })
        };
        let read = |n: u32, len: u64| -> Result<Vec<u8>, CloudError> {
            let mut f = std::fs::File::open(file)?;
            let offset = (n as u64 - 1) * part_size;
            f.seek(SeekFrom::Start(offset))?;
            let mut buf = Vec::with_capacity(len as usize);
            f.take(len).read_to_end(&mut buf)?;
            Ok(buf)
        };
        let mut etags: Vec<(u32, String)> = vec![];
        let mut next = 2u32;
        let mut sent = 0u64;
        let details = loop {
            let done = finished().transpose().map_err(CloudError::Aborted)?;
            let len = std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);
            // Whole parts after the first; when done, also the partial last one.
            while (next as u64) * part_size <= len || (done.is_some() && (next as u64 - 1) * part_size < len) {
                let size = part_size.min(len - (next as u64 - 1) * part_size);
                let bytes = read(next, size)?;
                etags.push((next, Self::put(url(next)?, &bytes, "video/mp4")?));
                sent += bytes.len() as u64;
                progress(sent);
                next += 1;
            }
            if let Some(d) = done {
                let first = read(1, part_size.min(len))?;
                etags.insert(0, (1, Self::put(url(1)?, &first, "video/mp4")?));
                progress(sent + first.len() as u64);
                break d;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        };
        if let (Some(url), Some(jpeg)) = (&plan.thumbnail_url, &details.poster) {
            Self::put(url, jpeg, "image/jpeg")?;
        }
        if let (Some(url), Some(gif)) = (&plan.gif_url, &details.gif) {
            Self::put(url, gif, "image/gif")?;
        }
        let parts: Vec<serde_json::Value> = etags.iter().map(|(n, e)| serde_json::json!({ "partNumber": n, "etag": e })).collect();
        let body = serde_json::json!({ "parts": parts, "durationMs": details.duration_ms, "width": details.width, "height": details.height });
        let done: VideoBody = self.send("POST", &format!("/api/videos/{}/complete", reservation.video.id), Some(body))?;
        Ok(done.video)
    }
}

// ───── Team workspaces ─────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// "owner" or "member".
    pub role: String,
    pub members: u32,
    /// Only shown to the owner.
    #[serde(default)]
    pub invite_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub email: Option<String>,
    pub role: String,
    #[serde(default)]
    pub you: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamVideo {
    #[serde(flatten)]
    pub video: Video,
    pub owner: Option<String>,
    pub yours: bool,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPreset {
    pub id: String,
    pub name: String,
    /// The style's settings (a `StylePreset` from the app).
    pub edit: serde_json::Value,
    pub updated_by: Option<String>,
}

#[derive(Deserialize)]
struct WorkspaceBody {
    workspace: Workspace,
}

impl Client {
    pub fn workspaces(&self) -> Result<Vec<Workspace>, CloudError> {
        #[derive(Deserialize)]
        struct Body {
            workspaces: Vec<Workspace>,
        }
        Ok(self.send::<Body>("GET", "/api/workspaces", None)?.workspaces)
    }

    pub fn create_workspace(&self, name: &str) -> Result<Workspace, CloudError> {
        Ok(self.send::<WorkspaceBody>("POST", "/api/workspaces", Some(serde_json::json!({ "name": name })))?.workspace)
    }

    pub fn join_workspace(&self, code: &str) -> Result<Workspace, CloudError> {
        Ok(self.send::<WorkspaceBody>("POST", "/api/workspaces/join", Some(serde_json::json!({ "code": code.trim() })))?.workspace)
    }

    pub fn workspace(&self, id: &str) -> Result<(Workspace, Vec<Member>), CloudError> {
        #[derive(Deserialize)]
        struct Body {
            workspace: Workspace,
            members: Vec<Member>,
        }
        let b: Body = self.send("GET", &format!("/api/workspaces/{id}"), None)?;
        Ok((b.workspace, b.members))
    }

    /// A new invite code (the old one stops working).
    pub fn rotate_invite(&self, id: &str) -> Result<Workspace, CloudError> {
        Ok(self.send::<WorkspaceBody>("POST", &format!("/api/workspaces/{id}/invite-code"), None)?.workspace)
    }

    /// Removes someone (owner), or leaves (your own id).
    pub fn remove_member(&self, id: &str, account: &str) -> Result<(), CloudError> {
        self.send::<serde_json::Value>("DELETE", &format!("/api/workspaces/{id}/members/{account}"), None).map(|_| ())
    }

    pub fn delete_workspace(&self, id: &str) -> Result<(), CloudError> {
        self.send::<serde_json::Value>("DELETE", &format!("/api/workspaces/{id}"), None).map(|_| ())
    }

    pub fn team_videos(&self, id: &str) -> Result<Vec<TeamVideo>, CloudError> {
        #[derive(Deserialize)]
        struct Body {
            videos: Vec<TeamVideo>,
        }
        Ok(self.send::<Body>("GET", &format!("/api/workspaces/{id}/videos"), None)?.videos)
    }

    pub fn team_presets(&self, id: &str) -> Result<Vec<TeamPreset>, CloudError> {
        #[derive(Deserialize)]
        struct Body {
            presets: Vec<TeamPreset>,
        }
        Ok(self.send::<Body>("GET", &format!("/api/workspaces/{id}/presets"), None)?.presets)
    }

    pub fn share_preset(&self, id: &str, preset_id: &str, name: &str, edit: &serde_json::Value) -> Result<(), CloudError> {
        let body = serde_json::json!({ "name": name, "edit": edit });
        self.send::<serde_json::Value>("PUT", &format!("/api/workspaces/{id}/presets/{preset_id}"), Some(body)).map(|_| ())
    }

    pub fn delete_preset(&self, id: &str, preset_id: &str) -> Result<(), CloudError> {
        self.send::<serde_json::Value>("DELETE", &format!("/api/workspaces/{id}/presets/{preset_id}"), None).map(|_| ())
    }
}

/// The link at a moment (`?t=` seconds), as viewers open it.
pub fn link_at(url: &str, seconds: Option<f64>) -> String {
    match seconds {
        Some(s) if s >= 1.0 => format!("{url}{}t={}", if url.contains('?') { "&" } else { "?" }, s as u64),
        _ => url.to_string(),
    }
}

/// Embed codes for a shared video.
pub fn embed_code(url: &str, kind: &str) -> String {
    let embed = url.replacen("/v/", "/e/", 1);
    match kind {
        "fixed" => format!(
            "<iframe src=\"{embed}\" width=\"640\" height=\"360\" frameborder=\"0\" allow=\"fullscreen; picture-in-picture\" allowfullscreen></iframe>"
        ),
        "gif" => format!("<a href=\"{url}\"><img src=\"{url}/preview.gif\" alt=\"Watch the video\" width=\"480\"></a>"),
        "thumbnail" => format!("<a href=\"{url}\"><img src=\"{url}/thumbnail.jpg\" alt=\"Watch the video\" width=\"640\"></a>"),
        _ => format!(
            "<div style=\"position:relative;padding-bottom:56.25%;height:0\"><iframe src=\"{embed}\" style=\"position:absolute;inset:0;width:100%;height:100%\" frameborder=\"0\" allow=\"fullscreen; picture-in-picture\" allowfullscreen></iframe></div>"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_and_embeds() {
        assert_eq!(link_at("https://umi.cam/v/abc", Some(75.4)), "https://umi.cam/v/abc?t=75");
        assert_eq!(link_at("https://umi.cam/v/abc", Some(0.3)), "https://umi.cam/v/abc");
        assert!(embed_code("https://umi.cam/v/abc", "responsive").contains("https://umi.cam/e/abc"));
        assert!(embed_code("https://umi.cam/v/abc", "gif").contains("preview.gif"));
    }
}
