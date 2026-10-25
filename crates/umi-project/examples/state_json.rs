//! Prints a recording's edit, placements and zoom segments as JSON (for UI fixtures).
fn main() {
    let path = std::env::args().nth(1).expect("bundle");
    let bundle = umi_project::Bundle::new(&path);
    let project = bundle.read_project().unwrap();
    let mut edit = project.effective_edit(None);
    edit.zoom.glide = true;
    let doc = umi_project::Document::new(project.clone(), edit.clone(), bundle.read_cursor(), project.duration);
    let out = serde_json::json!({
        "edit": edit,
        "placements": doc.placements(),
        "outputDuration": doc.output_duration(),
        "zoomSegments": doc.zoom_segments(),
        "recording": { "duration": project.duration, "width": project.screen.pixel_width, "height": project.screen.pixel_height, "hasCamera": project.camera.is_some(), "bundle": path, "hasKeys": true },
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
