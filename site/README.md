# umi.cam

The download page. Static files; the main button picks the right download for the visitor's
computer (macOS Apple silicon/Intel, Windows, Linux, ChromeOS → Chrome extension).

Preview: `python3 -m http.server -d site 8930` → http://localhost:8930

Add `editor.png` (a 2080×1170 screenshot of the editor) for the hero image. Download links
point at the latest GitHub release (`Umi_aarch64.dmg`, `Umi_x64.dmg`, `Umi_x64-setup.exe`,
`Umi_amd64.AppImage`, `Umi_amd64.deb`), which the release workflow produces.
