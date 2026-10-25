# Umi for Chrome

Record a tab, a window or the whole screen with camera and microphone, then download the
video or get a link through Umi Cloud. Works on ChromeOS too.

- `popup` — what to record, camera/mic/sound, start/stop (Alt+Shift+L anywhere)
- `background.js` — gets the stream (tabCapture / desktopCapture) and coordinates
- `offscreen.js` — records with MediaRecorder (VP9/Opus WebM), mixes tab sound and voice
- `bubble.js` + `camera.html` — round, draggable camera bubble in the recorded tab
- `result.html` — watch, download, upload (same API as the desktop app)

Load it: chrome://extensions → Developer mode → Load unpacked → this folder.
