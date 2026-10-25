---
name: umi
description: Find, transcribe, edit and export screen recordings made with Umi (the free screen recorder). Use when the user asks to tidy up, cut, caption, re-frame or export a recording.
---

# Working with Umi recordings

Umi keeps each recording as a `.umi` folder in `~/Movies/Umi` (Windows: `Videos\Umi`,
Linux: `~/Videos/Umi`). The `umi` MCP server edits them with the same engine as the app;
the app shows the changes the next time the recording is opened.

Set it up once:

```bash
claude mcp add umi -- /Applications/Umi.app/Contents/MacOS/umi-mcp
```

## Tools

- `list_recordings` — names, lengths, dates (newest first).
- `describe_recording {recording}` — length, size, look, cuts, captions.
- `transcribe {recording, language?}` — on-device transcription; stores captions and
  returns the text with times. Do this before cutting by words.
- `edit {recording, operations[]}` — operations run in order:
  `cut {start,end}` · `remove_fillers` · `shorten_pauses {min_seconds}` ·
  `zoom {start,end,scale}` · `captions {on}` · `aspect {value}` · `background {gradient}` ·
  `padding {value}` · `title {text,start,end}` · `noise_reduction {on}` · `undo_all`.
  Times are seconds of the current, edited video.
- `export {recording, format?, resolution?, destination?}` — writes an MP4 (or MOV/GIF).

## Good habits

- Transcribe first, then read the text to decide what to cut; cut from the end of the video
  backwards so earlier times don't shift.
- Prefer `remove_fillers` and `shorten_pauses` over many small cuts.
- Tell the user what changed and the new length; everything can be undone in the app.
