# Umi brand

The mark: a ring of dots, in one color (`#191A1A` on light, white on dark). Every file here is SVG;
the PNG/ICNS/ICO icons in `apps/desktop/src-tauri/icons` and `extension/icons` are exported from
these, because operating systems and Chrome only take bitmap icons.

- `umi-mark.svg` — the mark (`umi-mark-mono.svg` is the same file, kept for older references).
- `umi-mark-white.svg` — the mark in white, for dark backgrounds.
- `app-icon.svg` — the app icon: the mark on a white rounded tile (macOS icon grid, 1024 px).
- The favicon and in-app image (`apps/site/public/umi-mark.svg`, `apps/desktop/public/umi-mark.svg`)
  switch to white in dark mode.

Re-export the icons: render `app-icon.svg` to a 1024 px PNG, then
`cd apps/desktop && pnpm tauri icon <png> -o src-tauri/icons` (delete the android/ios folders it adds).
The menu bar icon `src-tauri/icons/tray.png` is the mark in black at 44 px (a template image).
