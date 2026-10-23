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

Local builds are ad-hoc signed, so macOS may ask for Screen Recording permission again after a rebuild. Set a development team in Xcode to avoid this.

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
