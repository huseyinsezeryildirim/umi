# Umi brand

The mark: sound bars around a record light. Every file here is SVG; the PNG/ICNS/ICO icons in
`apps/desktop/src-tauri/icons` and `extension/icons` are exported from these, because operating
systems and Chrome only take bitmap icons.

- `umi-mark.svg` — the mark, 15 bars, ink bars and a blue light. For large uses.
- `umi-mark-mono.svg` — the same in one color (black), for single-color printing.
- `umi-mark-small.svg` / `umi-mark-small-mono.svg` — 9 bolder bars, for 16–48 px (favicons, extension).
- `app-icon.svg` — the app icon: the mark on a white rounded tile.

Colors: ink `#111827`, Umi blue `#116ff5`.

Re-export the app icons: `cd apps/desktop && pnpm tauri icon <1024 px PNG of app-icon.svg> -o src-tauri/icons`.
