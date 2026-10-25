fn main() {
    // ScreenCaptureKit's Swift bridge needs the system Swift runtime on the search path.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    bake_keys();
    tauri_build::build()
}

/// Service keys the app ships with (Pexels): from the environment (CI secrets) or the
/// git-ignored `keys.env` at the repository root. Builds without them hide those features.
fn bake_keys() {
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../keys.env");
    println!("cargo:rerun-if-changed={}", file.display());
    println!("cargo:rerun-if-env-changed=UMI_PEXELS_KEY");
    let from_file = std::fs::read_to_string(&file).unwrap_or_default();
    let value = std::env::var("UMI_PEXELS_KEY").ok().filter(|v| !v.is_empty()).or_else(|| {
        from_file.lines().find_map(|l| l.trim().strip_prefix("UMI_PEXELS_KEY=").map(|v| v.trim().to_string()))
    });
    if let Some(v) = value {
        println!("cargo:rustc-env=UMI_PEXELS_KEY_BUILTIN={v}");
    }
}
