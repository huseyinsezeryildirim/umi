//! ONNX Runtime's prebuilt macOS library calls `__isPlatformVersionAtLeast` (for
//! `@available` checks), which lives in clang's runtime; Rust doesn't link it by default.

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let dir = std::process::Command::new("clang")
            .arg("--print-resource-dir")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| std::path::PathBuf::from(s.trim()).join("lib").join("darwin"));
        if let Some(dir) = dir.filter(|d| d.join("libclang_rt.osx.a").exists()) {
            println!("cargo:rustc-link-search=native={}", dir.display());
            println!("cargo:rustc-link-lib=static=clang_rt.osx");
        }
    }
}
