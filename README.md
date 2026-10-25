# Umi

Free, open-source screen recorder for macOS, Windows, Linux and Chrome. Unlimited local
recording and editing, commercial use included, AI that runs on your computer. Only hosted
features (links, insights, teams) are paid.

- Rust core (`crates/`): capture, recording, rendering (wgpu), media (FFmpeg), on-device AI
- Desktop app (`apps/desktop`): Tauri 2 + Solid, UI kit in `packages/ui`
- Website (`apps/site`): Next.js + Tailwind + Motion, exported as a static site
- Umi Cloud (`web/`): Cloudflare Worker + D1 + R2
- Chrome extension (`extension/`)

## Develop

```bash
pnpm install
pnpm dev                      # the desktop app (tauri dev)
pnpm --filter @umi/site dev   # the website on http://localhost:3100
cargo test --workspace --release
```

Service keys baked into builds (Pexels) come from the environment or a git-ignored
`keys.env` at the repository root (`UMI_PEXELS_KEY=…`).

Cloud, locally: `cd web && npm run setup:local && npm run dev`, then `node scripts/e2e.mjs`.

`scripts/make-fixture.sh` builds a synthetic recording in `/tmp/umi-fixtures` for render tests.

## Layout

```
crates/
  umi-project   .umi project format, edit settings, captions, insights
  umi-render    wgpu compositor: background, cursor, zoom, camera, captions
  umi-media     FFmpeg decode/encode, audio, GIF, remux
  umi-engine    export, audio mix, voice clean-up, tracking
  umi-capture   screen/camera/mic/input capture per platform
  umi-recorder  a recording session (prepare, begin, pause, stop, recover)
  umi-ai        Whisper, Kokoro voice, segmentation, face detection
  umi-cloud     Umi Cloud client
  umi-mcp       MCP server for AI agents
apps/desktop    the app
apps/site       umi.cam
packages/ui     design system
web/            Umi Cloud
extension/      Chrome extension
docs/           product, architecture, roadmap
```
