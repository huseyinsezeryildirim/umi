//! Prints the window layers of Finder and the Dock (no pictures, no titles): checks that
//! "hide desktop icons" finds Finder's desktop window. macOS only.
fn main() {
    #[cfg(target_os = "macos")]
    {
        use screencapturekit::prelude::*;
        let content = SCShareableContent::get().expect("screen recording permission");
        for w in content.windows() {
            let Some(app) = w.owning_application() else { continue };
            let bundle = app.bundle_identifier();
            if bundle == "com.apple.finder" || bundle == "com.apple.dock" {
                let options = umi_capture::screen::ScreenOptions { hide_desktop_icons: true, ..Default::default() };
                let out = umi_capture::screen::left_out(&options, false, w.title().as_deref(), w.window_layer(), &bundle);
                println!("{bundle:20} layer {:>12} on_screen {} left_out {out}", w.window_layer(), w.is_on_screen());
            }
        }
    }
}
