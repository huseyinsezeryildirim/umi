// The popup: choose what to record, start/stop. The recording itself runs in an offscreen
// document (so it keeps going when the popup closes); the service worker coordinates.
const $ = (id) => document.getElementById(id);
let source = "tab";

const prefs = await chrome.storage.local.get({ camera: false, mic: true, sound: true, source: "tab" });
source = prefs.source;
$("camera").checked = prefs.camera;
$("mic").checked = prefs.mic;
$("sound").checked = prefs.sound;
for (const b of document.querySelectorAll("#source button")) {
  b.classList.toggle("on", b.dataset.v === source);
  b.onclick = () => {
    source = b.dataset.v;
    for (const x of document.querySelectorAll("#source button")) x.classList.toggle("on", x === b);
    chrome.storage.local.set({ source });
  };
}
for (const id of ["camera", "mic", "sound"]) $(id).onchange = () => chrome.storage.local.set({ [id]: $(id).checked });

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "state" });
  $("setup").hidden = state.recording;
  $("recording").hidden = !state.recording;
  if (state.recording) {
    const s = Math.floor(state.elapsed);
    $("time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $("pause").textContent = state.paused ? "Resume" : "Pause";
  }
}
$("start").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: "start", source, tabId: tab?.id, camera: $("camera").checked, mic: $("mic").checked, sound: $("sound").checked });
  window.close();
};
$("stop").onclick = () => chrome.runtime.sendMessage({ type: "stop" }).then(() => window.close());
$("pause").onclick = () => chrome.runtime.sendMessage({ type: "pause" }).then(refresh);
$("settings").onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("result.html#settings") });
};
refresh();
setInterval(refresh, 500);
