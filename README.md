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

Local builds are ad-hoc signed, so macOS may ask for Screen Recording permission again after a rebuild. Set a development team in Xcode to avoid this.

## Layout

```
Umi/
  App/        app entry, menu bar UI
  Recording/  ScreenCaptureKit recorder, segments (pause/resume), merge
  Camera/     floating camera bubble
  Overlay/    countdown
  Library/    recordings list + player
docs/         product strategy and research
```
