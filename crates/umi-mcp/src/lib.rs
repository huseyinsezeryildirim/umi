//! Umi's MCP server (Model Context Protocol, JSON-RPC over stdio). It works on recordings in
//! the library folder directly, with the same Rust core as the app:
//!
//! - `list_recordings` — what's there
//! - `describe_recording` — length, size, look, cuts, captions
//! - `transcribe` — words with timings (on device)
//! - `edit` — change the look and cut the video with a few simple operations
//! - `export` — render an MP4/MOV/GIF
//!
//! The app runs it as `Umi --mcp` (see the desktop crate's `main`), so it ships with every
//! install: `claude mcp add umi -- /Applications/Umi.app/Contents/MacOS/umi-desktop --mcp`.
//! It also builds on its own as `umi-mcp`.

use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use umi_project::{Bundle, Document};

fn library() -> PathBuf {
    dirs::video_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Movies")).join("Umi")
}

/// A recording path from an argument: absolute, or a name in the library.
fn bundle_arg(args: &Value) -> Result<PathBuf, String> {
    let name = args.get("recording").and_then(Value::as_str).ok_or("`recording` (name or path) is required")?;
    let path = if Path::new(name).is_absolute() {
        PathBuf::from(name)
    } else {
        library().join(if name.ends_with(".umi") { name.to_string() } else { format!("{name}.umi") })
    };
    if !path.join("project.json").exists() {
        return Err(format!("No recording at {}", path.display()));
    }
    Ok(path)
}

fn open(path: &Path) -> Result<Document, String> {
    let bundle = Bundle::new(path);
    let project = bundle.read_project().map_err(|e| e.to_string())?;
    let edit = project.effective_edit(None);
    let media = umi_media::duration(&bundle.screen()).unwrap_or(project.duration);
    Ok(Document::new(project, edit, bundle.read_cursor(), media))
}

fn save(path: &Path, doc: &Document) -> Result<(), String> {
    let mut project = doc.project.clone();
    project.edit = Some(doc.edit.clone());
    Bundle::new(path).write_project(&project).map_err(|e| e.to_string())
}

fn tools() -> Value {
    json!([
        { "name": "list_recordings", "description": "List Umi recordings in the library, newest first.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "describe_recording", "description": "Length, size, look, cuts and caption status of a recording.",
          "inputSchema": { "type": "object", "properties": { "recording": { "type": "string", "description": "Recording name (as listed) or full path" } }, "required": ["recording"] } },
        { "name": "transcribe", "description": "Transcribe the recording's voice on this computer (Whisper). Stores the words as captions and returns the text with timings.",
          "inputSchema": { "type": "object", "properties": { "recording": { "type": "string" }, "language": { "type": "string", "description": "Code like en or tr; omit to detect" } }, "required": ["recording"] } },
        { "name": "edit", "description": "Edit a recording. Operations run in order. Times are in seconds of the current (edited) video.",
          "inputSchema": { "type": "object", "properties": {
              "recording": { "type": "string" },
              "operations": { "type": "array", "items": { "type": "object", "description":
                "One of: {op:'cut', start, end} · {op:'remove_fillers'} · {op:'shorten_pauses', min_seconds} · {op:'zoom', start, end, scale} · {op:'captions', on} · {op:'aspect', value: 'auto'|'wide'|'vertical'|'square'|'classic'|'portrait'} · {op:'background', gradient: 'sky'|'ice'|'navy'|'graphite'|'mist'|'mint'|'sand'|'dusk'|'ocean'|'peach'|'grape'|'night'} · {op:'padding', value: 0…0.4} · {op:'title', text, start, end} · {op:'noise_reduction', on} · {op:'undo_all'}" } } },
            "required": ["recording", "operations"] } },
        { "name": "export", "description": "Render the edited recording to a file (MP4 by default). Returns the file path.",
          "inputSchema": { "type": "object", "properties": { "recording": { "type": "string" }, "format": { "type": "string", "enum": ["mp4", "mov", "gif"] }, "resolution": { "type": "integer", "description": "Short side: 720, 1080, 1440, 2160" }, "destination": { "type": "string" } }, "required": ["recording"] } }
    ])
}

fn call(name: &str, args: &Value) -> Result<String, String> {
    match name {
        "list_recordings" => {
            let mut rows: Vec<(String, f64, String)> = std::fs::read_dir(library())
                .map_err(|e| e.to_string())?
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|e| e == "umi"))
                .filter_map(|p| {
                    let b = Bundle::new(&p);
                    let project = b.read_project().ok()?;
                    Some((b.name(), project.duration, project.created_at.to_rfc3339()))
                })
                .collect();
            rows.sort_by(|a, b| b.2.cmp(&a.2));
            Ok(rows.iter().map(|(n, d, c)| format!("{n} — {:.0} s — {c}", d)).collect::<Vec<_>>().join("\n"))
        }
        "describe_recording" => {
            let path = bundle_arg(args)?;
            let doc = open(&path)?;
            let e = &doc.edit;
            Ok(serde_json::to_string_pretty(&json!({
                "name": Bundle::new(&path).name(),
                "recordedSeconds": doc.project.duration,
                "videoSeconds": doc.output_duration(),
                "size": [doc.project.screen.pixel_width, doc.project.screen.pixel_height],
                "camera": doc.project.camera.is_some(),
                "clips": e.clips.iter().map(|c| json!({"start": c.start, "end": c.end, "speed": c.speed})).collect::<Vec<_>>(),
                "aspect": e.aspect, "background": e.background, "padding": e.padding,
                "zooms": doc.zoom_segments().len(), "captions": { "words": e.captions.words.len(), "shown": e.captions.enabled },
            }))
            .unwrap_or_default())
        }
        "transcribe" => {
            let path = bundle_arg(args)?;
            let mut doc = open(&path)?;
            let model = umi_ai::models::Model::WhisperBase.ensure(&|_| {}).map_err(|e| e.to_string())?;
            let screen = Bundle::new(&path).screen();
            let tracks = umi_media::audio_streams(&screen).map(|t| t.len()).unwrap_or(0);
            if tracks == 0 {
                return Err("This recording has no sound.".into());
            }
            let track = doc.project.audio.microphone_track.map(|t| t as usize).filter(|t| *t < tracks).unwrap_or(0);
            let samples = umi_ai::transcribe::read_mono_16k(&screen, track).map_err(|e| e.to_string())?;
            let language = args.get("language").and_then(Value::as_str).map(str::to_string);
            let (words, detected) =
                umi_ai::transcribe::transcribe(&model, &samples, language.as_deref(), |_| {}).map_err(|e| e.to_string())?;
            doc.edit.captions.words = words
                .iter()
                .map(|w| umi_project::edit::CaptionWord { id: uuid::Uuid::new_v4(), start: w.start, end: w.end, text: w.text.clone() })
                .collect();
            doc.edit.captions.language = detected.clone();
            save(&path, &doc)?;
            let lines: Vec<String> = umi_project::captions::caption_lines(&doc.edit.captions.words)
                .iter()
                .map(|l| format!("[{:.1}s] {}", l[0].start, l.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ")))
                .collect();
            Ok(format!("Language: {detected}\n{}", lines.join("\n")))
        }
        "edit" => {
            let path = bundle_arg(args)?;
            let mut doc = open(&path)?;
            let ops = args.get("operations").and_then(Value::as_array).ok_or("`operations` must be a list")?;
            let mut done = vec![];
            for op in ops {
                let num = |k: &str| op.get(k).and_then(Value::as_f64);
                let kind = op.get("op").and_then(Value::as_str).unwrap_or("");
                match kind {
                    "cut" => {
                        let (a, b) = (num("start").ok_or("cut needs start")?, num("end").ok_or("cut needs end")?);
                        doc.cut((a, b));
                    }
                    "remove_fillers" => {
                        let ids = umi_project::captions::filler_words(&doc.edit.captions.words);
                        doc.cut_words(&ids);
                    }
                    "shorten_pauses" => {
                        let ranges = umi_project::captions::long_pauses(&doc.edit.captions.words, num("min_seconds").unwrap_or(1.0), 0.3);
                        doc.cut_source_ranges(&ranges);
                    }
                    "zoom" => {
                        let start = num("start").ok_or("zoom needs start")?;
                        if let Some(umi_project::Selection::Zoom(id)) = doc.add_zoom(start) {
                            let end = num("end").unwrap_or(start + 3.0);
                            let src = |t: f64| doc.source_time(t).unwrap_or(t);
                            let (s, e) = (src(start), src(end));
                            doc.retime(umi_project::Selection::Zoom(id), s, e);
                            if let Some(z) = doc.edit.zoom.segments.iter_mut().find(|z| z.id == id) {
                                z.scale = num("scale").unwrap_or(1.8).clamp(1.0, 4.5);
                            }
                        }
                    }
                    "captions" => doc.edit.captions.enabled = op.get("on").and_then(Value::as_bool).unwrap_or(true),
                    "aspect" => {
                        doc.edit.aspect = serde_json::from_value(op.get("value").cloned().unwrap_or_default()).map_err(|e| e.to_string())?
                    }
                    "background" => {
                        let g = op.get("gradient").cloned().unwrap_or(json!("sky"));
                        doc.edit.background = serde_json::from_value(json!({ "gradient": { "_0": g } })).map_err(|e| e.to_string())?;
                    }
                    "padding" => doc.edit.padding = num("value").unwrap_or(0.08).clamp(0.0, 0.4),
                    "title" => {
                        let start = num("start").unwrap_or(0.0);
                        if let Some(umi_project::Selection::Text(id)) = doc.add_text(umi_project::edit::TextStyle::Title, start)
                            && let Some(t) = doc.edit.texts.iter_mut().find(|t| t.id == id)
                        {
                            t.text = op.get("text").and_then(Value::as_str).unwrap_or("Title").to_string();
                            if let Some(end) = num("end") {
                                t.end = t.start + (end - start).max(0.5);
                            }
                        }
                    }
                    "noise_reduction" => doc.edit.sound.denoise = op.get("on").and_then(Value::as_bool).unwrap_or(true),
                    "undo_all" => doc.edit = doc.project.default_edit(None),
                    other => return Err(format!("Unknown operation `{other}`")),
                }
                done.push(kind.to_string());
            }
            save(&path, &doc)?;
            Ok(format!("Done: {}. The video is now {:.1} s.", done.join(", "), doc.output_duration()))
        }
        "export" => {
            let path = bundle_arg(args)?;
            let doc = open(&path)?;
            let format = match args.get("format").and_then(Value::as_str) {
                Some("mov") => umi_engine::Format::Mov,
                Some("gif") => umi_engine::Format::Gif,
                _ => umi_engine::Format::Mp4,
            };
            let ext = match format {
                umi_engine::Format::Mov => "mov",
                umi_engine::Format::Gif => "gif",
                umi_engine::Format::Mp4 | umi_engine::Format::StreamingMp4 => "mp4",
            };
            let destination = args.get("destination").and_then(Value::as_str).map(PathBuf::from).unwrap_or_else(|| {
                let folder = library().join("Exports");
                let _ = std::fs::create_dir_all(&folder);
                folder.join(format!("{}.{ext}", Bundle::new(&path).name()))
            });
            let gpu = umi_render::Gpu::new().map_err(|e| e.to_string())?;
            let settings = umi_engine::ExportSettings {
                format,
                resolution: args.get("resolution").and_then(Value::as_u64).unwrap_or(1080) as u32,
                fps: 60,
                hardware: true,
                bit_rate: 0,
            };
            let cancel = std::sync::atomic::AtomicBool::new(false);
            umi_engine::export(gpu, &path, doc.edit.clone(), &settings, &destination, &|_| {}, &cancel).map_err(|e| e.to_string())?;
            Ok(format!("Exported {}", destination.display()))
        }
        other => Err(format!("Unknown tool `{other}`")),
    }
}

/// Handles one JSON-RPC message; `None` for notifications.
fn handle(message: &Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => json!({
            "protocolVersion": message.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "umi", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Umi records and edits screen videos. Use list_recordings to find one, describe_recording to see it, transcribe before cutting by words, edit to change it, export to make a file."
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = message.pointer("/params/name").and_then(Value::as_str).unwrap_or("");
            let args = message.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            match call(name, &args) {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
                Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
            }
        }
        _ => {
            return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("Unknown method {method}") } }));
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// Answers MCP messages on stdin until it closes.
pub fn serve() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(message) => handle(&message),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
        };
        if let Some(reply) = reply {
            let _ = writeln!(stdout, "{reply}");
            let _ = stdout.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speaks_the_protocol() {
        let init =
            handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } })).unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "umi");
        let list = handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 5);
        assert!(handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let bad = handle(
            &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "describe_recording", "arguments": {} } }),
        )
        .unwrap();
        assert_eq!(bad["result"]["isError"], true);
    }

    #[test]
    fn edits_a_copy_of_a_recording() {
        let source = Path::new("/tmp/umi-fixtures/Real.umi");
        if !source.exists() {
            return;
        }
        let copy = std::env::temp_dir().join("umi-mcp-test.umi");
        let _ = std::fs::remove_dir_all(&copy);
        std::fs::create_dir_all(&copy).unwrap();
        for f in ["project.json", "cursor.json", "screen.mov"] {
            std::fs::copy(source.join(f), copy.join(f)).unwrap();
        }
        let args = json!({ "recording": copy.to_string_lossy(), "operations": [
            { "op": "cut", "start": 1.0, "end": 3.0 }, { "op": "aspect", "value": "vertical" }, { "op": "background", "gradient": "dusk" }, { "op": "title", "text": "Hello", "start": 0.5 }
        ] });
        let out = call("edit", &args).unwrap();
        assert!(out.contains("cut, aspect, background, title"), "{out}");
        let described = call("describe_recording", &json!({ "recording": copy.to_string_lossy() })).unwrap();
        assert!(described.contains("\"vertical\"") && described.contains("dusk"), "{described}");
        let _ = std::fs::remove_dir_all(&copy);
    }
}
