# Parity checklist: Swift app → v2

A box is ticked only when the feature works in v2 **and** is covered by a test.
Platform columns: M = macOS, W = Windows, L = Linux, C = Chrome extension (where it applies).

## Project format
- [x] Read/write `project.json` written by the Swift app (all fields, tolerant decoding of old files)
- [x] `screen.mov`, `camera.mov`, `cursor.json`, `share.json`, media/music files in the bundle
- [x] Style presets (UserDefaults → app config file), default preset applied to new recordings

## Recording
- [x] Sources: full display, window, area (drag-select with size label, move, Enter/double-click), camera only
- [x] Camera on/off, device picker, mic on/off + level meter + device picker, system audio
- [x] Resolution (native/1080p/720p) and fps (60/30) settings
- [x] 3-second countdown
- [x] Pause/resume (clock shift), cancel/discard, stop
- [x] Cursor positions + clicks recorded to `cursor.json`
- [x] Instant mode (stop → polished 1080p export → clipboard; cloud link when connected)
- [x] Studio mode (stop → editor)
- [x] Global shortcuts ⌥⇧L start/stop, ⌥⇧P pause, ⌥⇧C cancel, ⌥⇧U launcher, ⌥⇧4 screenshot; customizable with conflict/in-use warnings
- [x] Control bar during recording (stop, pause, restart, discard, timer, draggable)
- [x] Ready bar when the launcher closes with camera on (record / camera off / open launcher)
- [x] Permission handling (screen, camera, mic) with a single in-app card, no repeated prompts

## Launcher (tray / menu bar)
- [x] Tray icon, left click launcher, right-click menu (start/stop, pause, discard, recent 5, screenshot, library, quit)
- [x] Source row, camera row + camera settings page, mic row with meter, system audio, Instant/Studio picker, Start button
- [x] "…" menu: screenshot, countdown, resolution, fps, keyboard shortcuts…, quit
- [x] Opens on the main page every time; hidden-tray fallback anchor
- [x] First-run tour (5 steps, once; ? restarts), demo control bar in tour
- [x] Idle: ~0 % CPU, mic meter and camera stop when closed

## Camera bubble
- [x] Floating, draggable, always on top; hover pill: close, size S/M/L, shape circle/squircle/square, mirror
- [x] Center Stage (where supported), macOS video effects shortcut (macOS only) — via the system Video Effects panel

## Editor
- [x] Preview (full/half quality), aspect presets (auto, 16:9, 9:16, 1:1, 4:3, 4:5), crop sheet with ratio locks
- [x] Device frames, background (gradient presets + angle, color, wallpapers, image, blurred screen), noise, randomize
- [x] Padding, corners + rounded/squircle, shadow, border
- [x] Cursor: style (arrow/dot), size, smoothing, motion blur, hide when idle, click ring
- [x] Camera: shape, size, position, mirror, visibility
- [x] Zoom: auto from clicks (stable ids), manual segments, scale, fixed focus point (drag on preview)
- [x] Privacy masks: blur / pixelate / dim (spotlight), drag/resize on preview
- [x] Scenes: default, camera only, split, floating… with transitions
- [x] Color grade presets
- [x] Text overlays: Title, Lower Third, Kicker, Big Stat, Quote, Typewriter; animations fade/slide/pop/typewriter; drag on preview; stacked rows
- [x] 3D camera moves
- [x] Captions: on-device transcription (Whisper), style, SRT/VTT export
- [x] Clips: split (S), cut tool (B, hover line, click), trim with yellow handles, reorder by drag, speed, delete, crossfade
- [x] Range select on ruler + Cut
- [x] Video 2 track (clip dragged down becomes overlay)
- [x] Media track: video/image overlays, fill / picture-in-picture, drag/resize, stacked rows
- [x] Music: library (50 CC0 tracks, stream preview, download+cache), audio file, volume, fade out, loop
- [x] Watermark/logo (corner, size, opacity)
- [x] Timeline: ruler with zoom-aware ticks, filmstrip, waveform, zoom slider, Add track menu, playhead, prev/next edge
- [x] Keys: Space, S, B, Z, Backspace/Delete, Escape, ⌘Z/⇧⌘Z
- [x] Undo/redo with gesture grouping
- [x] Presets menu (save current look, set default, apply)
- [x] Export sheet: MP4/MOV/GIF, 720p–4K, 30/60 fps, progress, show in folder, share
- [x] Share sheet (see Cloud)

## Screenshot
- [x] Area capture → editor: arrow, box, text, highlight, blur; colors; undo; look (background, frame, aspect, padding, corners, shadow); copy (⌘C), save PNG

## Library
- [x] Recordings grid with thumbnails, open editor, reveal, delete; Dock/taskbar presence while open

## Cloud sharing
- [x] Connect (server + token in OS keychain), create link (copied immediately), chunked upload with retry, poster + GIF preview
- [x] Link at time, password, expiry, download, comments toggle, delete link, open in browser
- [x] Embed: responsive / fixed iframe, GIF thumbnail code, thumbnail code

## New in v2 (beyond the Swift app)
- [x] Windows, Linux, Chrome extension
- [x] Loom library import (free)
- [x] On-device AI: title, summary, chapters
- [x] Download website with OS detection
