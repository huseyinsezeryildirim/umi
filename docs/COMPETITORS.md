# Competitors and what to take from them

Checked: Loom, Cap, OpenScreen, Screen Studio, Tella, Canvid (October 2026).

| | Platforms | Model | Price |
|---|---|---|---|
| **Loom** | Mac, Win, Chrome, mobile | Cloud-first, limited free | Business plans per seat |
| **Cap** | Mac, Win | Open source (AGPL); free personal only; Loom import and AI in Pro | $29/yr desktop, $12/user/mo Pro |
| **OpenScreen** | Mac, Win, Linux | MIT, everything free, no cloud | Free |
| **Screen Studio** | Mac only | All features in one plan; links up to 30 min | $9/mo yearly, $29/mo monthly |
| **Tella** | Mac, Win, web, Chrome | Editing + hosting + analytics, workspaces | From $13/mo |
| **Canvid** | Mac, Win | Lifetime license or yearly; needs internet to run | $75 lifetime / $84 yr |

**Umi:** free and open source for everything that runs on your computer (including
commercial use and on-device AI), paid only for cloud and team features.

## Features we don't have yet

### Free (runs on the user's machine)
- [x] **Text-based editing**: delete words in the transcript to cut the video (Screen Studio, Tella)
- [x] **Remove filler words and long pauses** in one click (Screen Studio, Tella)
- [x] **Speed up long typing** automatically (Screen Studio)
- [x] **Noise and echo removal, voice leveling** on device (all three)
- [x] **Camera background blur / replace / remove** without green screen (Screen Studio, Canvid, OpenScreen)
- [x] **Face tracking** for the camera crop; **hide camera during silence** (Screen Studio)
- [x] **Smart framing**: move the camera bubble when it would cover the cursor (Screen Studio)
- [x] **Loupe zoom** (magnifier around the cursor) besides the classic zoom (Screen Studio)
- [x] **Keystroke overlay**: show keyboard shortcuts on screen (Screen Studio)
- [x] **Click sounds** (Screen Studio)
- [x] **Caption styles and animations**, captions repositioned per aspect ratio (Screen Studio)
- [x] **Speaker notes / teleprompter** while recording (Screen Studio)
- [x] **Resize the window to an exact size** before recording (Screen Studio)
- [x] **Autosave and crash recovery** during recording (Screen Studio)
- [x] **Multiple takes / clips combined** into one video (Tella)
- [x] **Import existing videos** and edit them like recordings (Screen Studio)
- [x] **iPhone/iPad recording over USB** with device mockups (Screen Studio, macOS) — not yet tried with a real device
- [x] **Reel-mode preview** (TikTok/Instagram UI overlay for 9:16) (Screen Studio)
- [ ] **Unsplash backgrounds** (Screen Studio) — needs an Unsplash API key; system wallpapers and your own images work
- [x] **⌘K command menu** in the editor (Screen Studio)
- [x] **AI agent / MCP and Claude Code skills** to drive recording and editing (Cap, Tella)

### Paid (cloud / team)
- [x] **Viewer analytics**: who watched, how long, where they dropped off (Tella, Loom)
- [ ] **Shared workspaces and libraries**, shared editable projects and presets (Screen Studio, Tella)
- [ ] **Publish to YouTube, LinkedIn, X** from the app (Tella)
- [ ] **Private links for chosen viewers** (Screen Studio)
- [x] **AI voiceover** from a typed script (Screen Studio) — done on device (Kokoro), so it is free
- [ ] **Cloud transcription and translation** for long or many videos
- [ ] **SOC 2, SSO, custom domain** for companies (Tella, Cap, Loom)

## Where we're already ahead
- Free commercial use and unlimited local recording/editing (Cap's free tier forbids commercial use)
- Free Loom import (Cap: Pro only)
- On-device AI titles, summaries and chapters at zero cost (Cap: Pro, cloud)
- Comments, reactions, embed, GIF previews, password/expiry on links
- One renderer on Mac, Windows, Linux and Chrome (Screen Studio: Mac only; OpenScreen: no cloud)
