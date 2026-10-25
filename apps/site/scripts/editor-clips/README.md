# Editor clips for the landing page

The feature cards play recordings of Umi's own editor (the desktop app's UI running on its demo
backend, `apps/desktop/src/dev/mock.ts`), so the site always shows the real interface.

1. Run the desktop UI: `cd apps/desktop && pnpm dev` (http://localhost:1420).
2. Record a scene with headless Chrome: `node rec.mjs <zoom|ums|masks|clips> <out-dir>`.
   Scenes (URL, clicks, timing) are in `scenes.mjs`.
3. Crop to what matters and encode into `public/media/editor-<name>.mp4` (+ poster `.jpg`):

```
zoom   crop=1084:501:12:52,scale=960:-2
masks  crop=640:400:240:105,scale=960:-2
ums    split → panel crop=320:150:1108:625 and timeline crop=1084:70:12:652, both scale=640, vstack
clips  crop=760:120:12:615,scale=960:-2
```

with `ffmpeg -f concat -safe 0 -i <out>/<name>-frames/list.txt -filter_complex "<filter>[o]" -map "[o]" -r 30 -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart -an`.
