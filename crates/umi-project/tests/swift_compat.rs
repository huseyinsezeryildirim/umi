//! Projects written by the Swift app must open unchanged, and survive a round trip.

use std::path::PathBuf;
use umi_project::{Bundle, EditSettings, RecordingProject};

/// Every `.umi` bundle we can find: the test fixtures and the user's recordings.
fn bundles() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from("/tmp/umi-fixtures")];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Movies/Umi"));
    }
    dirs.iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flat_map(|entries| entries.filter_map(Result::ok).map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "umi") && p.join("project.json").exists())
        .collect()
}

#[test]
fn reads_and_round_trips_swift_projects() {
    let found = bundles();
    for path in &found {
        let bundle = Bundle::new(path);
        let project = bundle.read_project().unwrap_or_else(|e| panic!("{e}"));
        assert!(project.duration > 0.0, "{path:?}");
        let json = serde_json::to_string(&project).unwrap();
        let back: RecordingProject = serde_json::from_str(&json).unwrap();
        assert_eq!(back, project, "round trip changed {path:?}");
        let _ = bundle.read_cursor();
    }
    eprintln!("checked {} Swift projects", found.len());
}

#[test]
fn swift_edit_json_decodes_field_by_field() {
    let json = r#"{
        "background": { "gradient": { "_0": "sky" } },
        "backgroundAngle": 135, "padding": 0.0148, "cornerStyle": "squircle",
        "crop": [[0.1, 0.2], [0.5, 0.6]],
        "camera": { "mirrored": true, "position": [0.89, 0.79], "shape": "circle", "size": 0.26, "visible": true },
        "cursor": { "clickRings": true, "size": 1.5, "smoothing": "smooth", "visible": true },
        "zoom": { "auto": false, "scale": 1.8, "segments": [
            { "end": 9.8, "id": "00000000-0000-4000-8000-000000001F71", "scale": 2.8, "start": 6.2 } ] },
        "overlays": [ { "id": "6F0D7E8A-2C2B-4E0C-9D7B-5E7A3C0B2D11", "file": "screen.mov", "kind": "video",
                        "start": 1, "end": 3, "mediaOffset": 2, "mode": "fill", "center": [0.72, 0.3], "width": 0.4, "lane": 2 } ],
        "music": { "file": "music-ABC123.mp3", "title": "Funshine", "volume": 0.35, "fadeOut": 2 },
        "frame": "macOS",
        "grade": "not an object"
    }"#;
    let edit: EditSettings = serde_json::from_str(json).unwrap();
    assert_eq!(edit.corner_style, umi_project::edit::CornerStyle::Squircle);
    assert_eq!(edit.crop.unwrap().width(), 0.5);
    assert_eq!(edit.zoom.segments[0].id.to_string().to_uppercase(), "00000000-0000-4000-8000-000000001F71");
    assert!(edit.overlays[0].is_video2());
    assert_eq!(edit.frame, umi_project::edit::DeviceFrame::MacOs);
    // Unreadable field falls back to its default instead of failing the whole edit.
    assert_eq!(edit.grade, Default::default());
    // Missing fields get Swift's defaults.
    assert_eq!(edit.shadow, 0.6);
    assert_eq!(edit.captions.language, "en-US");

    let out = serde_json::to_value(&edit).unwrap();
    assert_eq!(out["background"]["gradient"]["_0"], "sky");
    assert_eq!(out["zoom"]["segments"][0]["id"], "00000000-0000-4000-8000-000000001F71");
    assert_eq!(out["crop"][1][0], 0.5);
}
