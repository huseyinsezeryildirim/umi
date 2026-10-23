# Umi

Free, native macOS screen recorder in the spirit of Loom. Unlimited local recording and editing, commercial use allowed. Only cloud sharing will be paid.

- macOS 15+, Swift 6, SwiftUI + AppKit, ScreenCaptureKit
- Menu bar app (`LSUIElement`), recordings saved to `~/Movies/Umi`

## Build

The Xcode project is generated from `project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen) and is not committed.

```bash
brew install xcodegen
xcodegen generate
open Umi.xcodeproj
```

Schemes:

| Scheme | Config | Use |
|---|---|---|
| `Umi` | Debug / Release | Direct distribution (notarized DMG). Hardened runtime, no sandbox. |
| `Umi-AppStore` | Release-AppStore | Mac App Store. Sandboxed, `APPSTORE` compile flag. |

Build outside `~/Desktop` (Xcode's default DerivedData is fine); an app binary inside Desktop triggers a Desktop-folder privacy prompt.

Tests: `scripts/make-fixture.sh` creates a synthetic project in `/tmp/umi-fixtures`, then run the `Umi` scheme's tests. In Debug, `UMI_OPEN_EDITOR=/path/to/X.umi` opens that project's editor on launch.

Builds are signed with the team's Apple Development identity (`project.yml`) so macOS keeps Screen Recording / Camera / Mic permissions across rebuilds. Don't run several differently-signed copies of `cam.umi.app` side by side (e.g. from worktrees): macOS will keep re-asking for permission.

## Layout

```
Umi/
  App/        app entry, menu bar UI
  Recording/  ScreenCaptureKit capture, writers, shared clock, cursor log
  Project/    .umi project format and edit settings
  Render/     Core Image compositor, cursor/zoom tracks, composition, export
  Editor/     editor window: preview, timeline, inspector
  Camera/     camera session + floating bubble
  Overlay/    countdown
  Library/    recordings list + player
docs/         product strategy and research
```
