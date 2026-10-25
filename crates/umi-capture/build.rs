//! ScreenCaptureKit's bridge uses Swift Concurrency; the Swift runtime lives in
//! /usr/lib/swift on macOS, which binaries need on their search path.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}
