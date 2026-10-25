// Records a scripted run of the editor demo as an MP4 (CDP screencast → ffmpeg), cropped.
// usage: node rec.mjs <name> <url> <x,y,w,h> <seconds>  (actions in scenes.mjs)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [, , name, out] = process.argv;
const scenes = (await import("./scenes.mjs")).default;
const scene = scenes[name];
const dir = `${out}/${name}-frames`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${out}/../profile-rec`, "--window-size=1440,900", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch("http://127.0.0.1:9334/json")).json(); if (targets.length) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const frames = [];
let recording = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Page.screencastFrame") {
    send("Page.screencastFrameAck", { sessionId: d.params.sessionId });
    if (recording) frames.push({ t: d.params.metadata.timestamp, data: d.params.data });
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const at = (sel) => evaluate(`(()=>{const e=(${sel});if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
const move = async (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
const click = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const key = async (k, code, vk, modifiers = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: scene.url }); await sleep(5000);
await scene.before?.({ evaluate, at, click, move, key, sleep, send });
await send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 2880, maxHeight: 1800, everyNthFrame: 1 });
await sleep(300); recording = true;
await scene.run({ evaluate, at, click, move, key, sleep, send });
recording = false;
await send("Page.stopScreencast"); ws.close(); chrome.kill();
// Frames come at irregular times: give each its real duration.
let list = "";
frames.forEach((f, i) => {
  const file = `${String(i).padStart(4, "0")}.jpg`;
  writeFileSync(`${dir}/${file}`, Buffer.from(f.data, "base64"));
  const dur = i + 1 < frames.length ? frames[i + 1].t - f.t : 0.5;
  list += `file '${file}'\nduration ${Math.max(0.01, dur).toFixed(4)}\n`;
});
list += `file '${String(frames.length - 1).padStart(4, "0")}.jpg'\n`;
writeFileSync(`${dir}/list.txt`, list);
const k = frames.length ? (await import("node:child_process")).execFileSync("sips", ["-g", "pixelWidth", `${dir}/0000.jpg`]).toString().includes("2880") ? 2 : 1 : 1;
const [x, y, w, h] = scene.crop.map((v) => v * k);
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`, "-vf", `crop=${w}:${h}:${x}:${y},scale=${Math.min(scene.width ?? 1280, w)}:-2,fps=30,format=yuv420p`, "-c:v", "libx264", "-crf", "22", "-preset", "slow", "-movflags", "+faststart", "-an", `${out}/${name}.mp4`]);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `${out}/${name}.mp4`, "-vframes", "1", "-q:v", "3", `${out}/${name}.jpg`]);
console.log(name, frames.length, "frames");
