#!/bin/zsh
# Builds a synthetic .umi project (no screen-recording permission needed) for render tests.
set -euo pipefail
out="${1:-/tmp/umi-fixtures/Fixture.umi}"
mkdir -p "$out"
ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1200:rate=60:duration=6" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=6" \
  -map 0:v -map 1:a -map 2:a -c:v libx264 -pix_fmt yuv420p -c:a aac -ac:a:0 2 -ac:a:1 1 "$out/screen.mov"
ffmpeg -loglevel error -y -f lavfi -i "smptebars=size=1280x720:rate=30:duration=6" -c:v libx264 -pix_fmt yuv420p "$out/camera.mov"
python3 - "$out" <<'PY'
import json, math, sys, os
out = sys.argv[1]
moves = [{"t": i/60, "x": 0.5 + 0.3*math.cos(i/60*1.5), "y": 0.5 + 0.3*math.sin(i/60*1.5)} for i in range(360)]
clicks = [{"t": 1.5, "x": moves[90]["x"], "y": moves[90]["y"], "button": "left"},
          {"t": 2.2, "x": moves[132]["x"], "y": moves[132]["y"], "button": "left"}]
json.dump({"moves": moves, "clicks": clicks}, open(os.path.join(out, "cursor.json"), "w"))
json.dump({
  "version": 1, "createdAt": "2026-10-23T20:00:00Z", "duration": 6.0,
  "screen": {"pixelWidth": 1920, "pixelHeight": 1200, "captureRect": [[0, 0], [960, 600]], "fps": 60},
  "camera": {"bubbleCenter": [0.1, 0.85]},
  "audio": {"systemTrack": 0, "microphoneTrack": 1}
}, open(os.path.join(out, "project.json"), "w"), indent=2)
PY
echo "$out"
