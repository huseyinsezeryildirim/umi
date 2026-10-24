# Umi architecture (v2: cross-platform)

Umi moves from a macOS-only Swift app to one codebase for **macOS, Windows, Linux and Chrome**.
The Swift app (`Umi/`) is the feature spec and the visual reference until the new app matches it
feature for feature; then it is removed. Nothing ships with fewer features than today.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Rust core** for capture, recording, rendering, export, project files, cloud upload | One implementation on every OS; fast and memory safe; same choice as Cap. |
| 2 | **Tauri 2** desktop shell | Small binaries (no bundled Chromium), native windows/tray/shortcuts, Rust backend. |
| 3 | **SolidJS + TypeScript** for all UI | Fine-grained reactivity (no virtual DOM): the timeline and inspector stay at 60 fps. The same components run in the desktop app, the web viewer/editor and the Chrome extension. |
| 4 | **wgpu** renderer | One GPU compositor for preview and export on Metal, DirectX 12 and Vulkan, and WebGPU in the browser. |
| 5 | **FFmpeg** (`ffmpeg-next`) for decode/encode/mux | One media pipeline everywhere, using hardware encoders (VideoToolbox, NVENC/QSV/AMF, VAAPI) when present. |
| 6 | **`.umi` project format unchanged** | Recordings made by the Swift app open in v2. Compatibility is tested against real Swift-written projects. |
| 7 | **Design system package** (`packages/ui`) | Tokens + components used by every surface. No ad-hoc colors, sizes or one-off buttons in apps. |
| 8 | **On-device AI** behind engine traits | Whisper for transcripts everywhere; Apple Foundation Models / Windows on-device models / Chrome built-in AI / local open model for titles, summaries, chapters. Zero server cost. |
| 9 | Monorepo with **Cargo + pnpm workspaces** | One PR changes core, UI and web together; CI builds all platforms. |

## Layout

```
crates/
  umi-project     project model (.umi): settings, clips, zooms, masks, texts…  (pure, no I/O deps)
  umi-render      wgpu compositor: background, screen card, cursor, zoom, camera, overlays, text, captions
  umi-media       FFmpeg: decode frames, encode/mux MP4/MOV/GIF, waveform, thumbnails
  umi-capture     traits ScreenSource / CameraSource / AudioSource / CursorSource + per-OS backends
  umi-recorder    session state machine: countdown, pause/resume clock, writers → .umi bundle
  umi-cloud       Umi Cloud API client, chunked resumable upload
  umi-ai          TranscriptionEngine / SummaryEngine traits + engines
apps/
  desktop         Tauri app (Rust commands + Solid UI): launcher, editor, library, overlays…
  web             Cloudflare Worker: share backend + viewer   (today: web/)
  extension       Chrome extension recorder
packages/
  ui              design system: tokens (CSS variables) + Solid components
  bindings        TypeScript types generated from the Rust models (single source of truth)
```

## SOLID boundaries

- **S** — each crate has one job; inside `umi-render` every effect is its own layer module.
- **O** — new effects, capture backends, AI engines and export formats are added as new
  implementations of an existing trait, without editing the pipeline that uses them.
- **L** — every backend honours its trait contract; contract tests run against all implementations
  available on the CI machine.
- **I** — small traits (`ScreenSource` does not know about audio; `Encoder` does not know about files).
- **D** — `umi-recorder` and `umi-render` depend on traits, never on a concrete OS API. Concrete
  backends are chosen at the app edge (`apps/desktop`).

## Performance budget

| Path | Budget |
|---|---|
| Recording overhead | < 10 % CPU on Apple Silicon at 1080p60, hardware encode, no frame drops |
| Editor preview | 60 fps at preview size; scrubbing response < 50 ms |
| Export | ≥ 2× real time at 1080p60 on Apple Silicon |
| Idle (launcher closed) | ~0 % CPU, mic/camera fully released |
| Cold start to launcher | < 300 ms |

Benchmarks live next to the code (`cargo bench`) and run in CI to catch regressions.

## Parity

`docs/PARITY.md` lists every feature of the Swift app. A feature is checked only when it works in
v2 **and** has a test (unit, golden image or UI). Render parity uses golden images exported from the
Swift renderer for the same project and settings.
