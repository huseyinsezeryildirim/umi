# Parity checklist: Swift app → v2

A box is ticked only when the feature works in v2 **and** is covered by a test.
Platform columns: M = macOS, W = Windows, L = Linux, C = Chrome extension (where it applies).

## Project format
- [ ] Read/write `project.json` written by the Swift app (all fields, tolerant decoding of old files)
- [ ] `screen.mov`, `camera.mov`, `cursor.json`, `share.json`, media/music files in the bundle
- [ ] Style presets (UserDefaults → app config file), default preset applied to new recordings

## Recording
- [ ] Sources: full display, window, area (drag-select with size label, move, Enter/double-click), camera only
- [ ] Camera on/off, device picker, mic on/off + level meter + device picker, system audio
- [ ] Resolution (native/1080p/720p) and fps (60/30) settings
- [ ] 3-second countdown
- [ ] Pause/resume (clock shift), cancel/discard, stop
- [ ] Cursor positions + clicks recorded to `cursor.json`
- [ ] Instant mode (stop → polished 1080p export → clipboard; cloud link when connected)
- [ ] Studio mode (stop → editor)
- [ ] Global shortcuts ⌥⇧L start/stop, ⌥⇧P pause, ⌥⇧C cancel, ⌥⇧U launcher, ⌥⇧4 screenshot; customizable with conflict/in-use warnings
- [ ] Control bar during recording (stop, pause, restart, discard, timer, draggable)
- [ ] Ready bar when the launcher closes with camera on (record / camera off / open launcher)
- [ ] Permission handling (screen, camera, mic) with a single in-app card, no repeated prompts

## Launcher (tray / menu bar)
- [ ] Tray icon, left click launcher, right-click menu (start/stop, pause, discard, recent 5, screenshot, library, quit)
- [ ] Source row, camera row + camera settings page, mic row with meter, system audio, Instant/Studio picker, Start button
- [ ] "…" menu: screenshot, countdown, resolution, fps, keyboard shortcuts…, quit
- [ ] Opens on the main page every time; hidden-tray fallback anchor
- [ ] First-run tour (5 steps, once; ? restarts), demo control bar in tour
- [ ] Idle: ~0 % CPU, mic meter and camera stop when closed

## Camera bubble
- [ ] Floating, draggable, always on top; hover pill: close, size S/M/L, shape circle/squircle/square, mirror
- [ ] Center Stage (where supported), macOS video effects shortcut (macOS only)

## Editor
- [ ] Preview (full/half quality), aspect presets (auto, 16:9, 9:16, 1:1, 4:3, 4:5), crop sheet with ratio locks
- [ ] Device frames, background (gradient presets + angle, color, wallpapers, image, blurred screen), noise, randomize
- [ ] Padding, corners + rounded/squircle, shadow, border
- [ ] Cursor: style (arrow/dot), size, smoothing, motion blur, hide when idle, click ring
- [ ] Camera: shape, size, position, mirror, visibility
- [ ] Zoom: auto from clicks (stable ids), manual segments, scale, fixed focus point (drag on preview)
- [ ] Privacy masks: blur / pixelate / dim (spotlight), drag/resize on preview
- [ ] Scenes: default, camera only, split, floating… with transitions
- [ ] Color grade presets
- [ ] Text overlays: Title, Lower Third, Kicker, Big Stat, Quote, Typewriter; animations fade/slide/pop/typewriter; drag on preview; stacked rows
- [ ] 3D camera moves
- [ ] Captions: on-device transcription (Whisper), style, SRT/VTT export
- [ ] Clips: split (S), cut tool (B, hover line, click), trim with yellow handles, reorder by drag, speed, delete, crossfade
- [ ] Range select on ruler + Cut
- [ ] Video 2 track (clip dragged down becomes overlay)
- [ ] Media track: video/image overlays, fill / picture-in-picture, drag/resize, stacked rows
- [ ] Music: library (50 CC0 tracks, stream preview, download+cache), audio file, volume, fade out, loop
- [ ] Watermark/logo (corner, size, opacity)
- [ ] Timeline: ruler with zoom-aware ticks, filmstrip, waveform, zoom slider, Add track menu, playhead, prev/next edge
- [ ] Keys: Space, S, B, Z, Backspace/Delete, Escape, ⌘Z/⇧⌘Z
- [ ] Undo/redo with gesture grouping
- [ ] Presets menu (save current look, set default, apply)
- [ ] Export sheet: MP4/MOV/GIF, 720p–4K, 30/60 fps, progress, show in folder, share
- [ ] Share sheet (see Cloud)

## Screenshot
- [ ] Area capture → editor: arrow, box, text, highlight, blur; colors; undo; look (background, frame, aspect, padding, corners, shadow); copy (⌘C), save PNG

## Library
- [ ] Recordings grid with thumbnails, open editor, reveal, delete; Dock/taskbar presence while open

## Cloud sharing
- [ ] Connect (server + token in OS keychain), create link (copied immediately), chunked upload with retry, poster + GIF preview
- [ ] Link at time, password, expiry, download, comments toggle, delete link, open in browser
- [ ] Embed: responsive / fixed iframe, GIF thumbnail code, thumbnail code

## New in v2 (beyond the Swift app)
- [ ] Windows, Linux, Chrome extension
- [ ] Loom library import (free)
- [ ] On-device AI: title, summary, chapters
- [ ] Download website with OS detection
