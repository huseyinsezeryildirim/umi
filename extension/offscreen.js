// The recorder: captures the chosen stream (+ microphone), mixes the sound, records WebM
// and stores the result for the result page.
import { saveRecording } from "./store.js";

let recorder = null;
let chunks = [];
let streams = [];
let audio = null;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "offscreen-start") {
    begin(msg).then(() => reply({ started: true }), (e) => reply({ started: false, error: String(e) }));
    return true;
  }
  if (msg.type === "offscreen-stop") recorder?.stop();
  if (msg.type === "offscreen-pause") recorder?.pause();
  if (msg.type === "offscreen-resume") recorder?.resume();
  reply?.({});
});

async function begin({ streamId, source, mic, sound }) {
  const mandatory = { chromeMediaSource: source === "tab" ? "tab" : "desktop", chromeMediaSourceId: streamId };
  const display = await navigator.mediaDevices.getUserMedia({
    video: { mandatory: { ...mandatory, maxFrameRate: 60, maxWidth: 3840, maxHeight: 2160 } },
    audio: sound ? { mandatory } : false,
  });
  streams = [display];
  audio = new AudioContext();
  const mix = audio.createMediaStreamDestination();
  if (display.getAudioTracks().length) {
    const s = audio.createMediaStreamSource(display);
    s.connect(mix);
    // A captured tab goes quiet for the user unless its sound is played back.
    if (source === "tab") s.connect(audio.destination);
  }
  if (mic) {
    try {
      const voice = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streams.push(voice);
      audio.createMediaStreamSource(voice).connect(mix);
    } catch {
      // No microphone permission: record without it.
    }
  }
  const tracks = [...display.getVideoTracks(), ...mix.stream.getAudioTracks()];
  const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 8_000_000 });
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    for (const s of streams) s.getTracks().forEach((t) => t.stop());
    await audio?.close();
    const blob = new Blob(chunks, { type: "video/webm" });
    const key = await saveRecording(blob);
    chrome.runtime.sendMessage({ type: "recorded", key });
  };
  // If the user ends sharing from Chrome's own bar.
  display.getVideoTracks()[0].onended = () => recorder?.state !== "inactive" && recorder.stop();
  recorder.start(1000);
}
