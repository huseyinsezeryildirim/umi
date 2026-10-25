// Service worker: starts the offscreen recorder with the right stream, shows the camera
// bubble in the recorded tab, and opens the result page when done.
let state = { recording: false, paused: false, startedAt: 0, pausedFor: 0, pausedAt: 0, tabId: null };

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA", "DISPLAY_MEDIA"], justification: "Recording the screen, camera and microphone" });
}

async function start(msg) {
  if (state.recording) return;
  let streamId;
  if (msg.source === "tab") {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId });
  } else {
    streamId = await new Promise((resolve) => chrome.desktopCapture.chooseDesktopMedia(["screen", "window", "audio"], (id) => resolve(id)));
    if (!streamId) return;
  }
  await ensureOffscreen();
  const ok = await chrome.runtime.sendMessage({ type: "offscreen-start", target: "offscreen", streamId, source: msg.source, mic: msg.mic, sound: msg.sound });
  if (!ok?.started) return;
  state = { recording: true, paused: false, startedAt: Date.now(), pausedFor: 0, pausedAt: 0, tabId: msg.tabId };
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#ff4d4d" });
  if (msg.camera && msg.tabId) {
    await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ["bubble.js"] }).catch(() => {});
  }
}

async function stop() {
  if (!state.recording) return;
  await chrome.runtime.sendMessage({ type: "offscreen-stop", target: "offscreen" });
  if (state.tabId) chrome.scripting.executeScript({ target: { tabId: state.tabId }, func: () => document.getElementById("umi-bubble")?.remove() }).catch(() => {});
  state.recording = false;
  chrome.action.setBadgeText({ text: "" });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target === "offscreen") return;
  if (msg.type === "state") {
    const now = Date.now();
    const paused = state.paused ? now - state.pausedAt : 0;
    reply({ recording: state.recording, paused: state.paused, elapsed: state.recording ? (now - state.startedAt - state.pausedFor - paused) / 1000 : 0 });
  } else if (msg.type === "start") {
    start(msg).then(() => reply({}));
    return true;
  } else if (msg.type === "stop") {
    stop().then(() => reply({}));
    return true;
  } else if (msg.type === "pause") {
    if (state.paused) state.pausedFor += Date.now() - state.pausedAt;
    else state.pausedAt = Date.now();
    state.paused = !state.paused;
    chrome.runtime.sendMessage({ type: state.paused ? "offscreen-pause" : "offscreen-resume", target: "offscreen" });
    reply({});
  } else if (msg.type === "recorded") {
    // The offscreen document finished the file: show it.
    chrome.tabs.create({ url: chrome.runtime.getURL(`result.html#${msg.key}`) });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-recording") return;
  if (state.recording) return stop();
  const prefs = await chrome.storage.local.get({ camera: false, mic: true, sound: true, source: "tab" });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  start({ ...prefs, tabId: tab?.id });
});
