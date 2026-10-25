// The result page: watch, download, or upload to Umi Cloud for a link.
import { deleteRecording, loadRecording } from "./store.js";

const $ = (id) => document.getElementById(id);
const key = location.hash.slice(1);
const cloud = await chrome.storage.local.get({ server: "https://umi.cam", token: "" });
$("server").value = cloud.server;
$("token").value = cloud.token;
$("save").onclick = async () => {
  await chrome.storage.local.set({ server: $("server").value.replace(/\/+$/, "") || "https://umi.cam", token: $("token").value.trim() });
  $("status").textContent = "Saved.";
};

const saved = key.startsWith("rec-") ? await loadRecording(key) : null;
if (!saved) {
  for (const id of ["video", "download", "share", "discard"]) $(id).hidden = true;
} else {
  $("settings").open = false;
  const url = URL.createObjectURL(saved.blob);
  $("video").src = url;
  const name = `Umi ${new Date(saved.at).toISOString().slice(0, 19).replace("T", " at ").replaceAll(":", ".")}.webm`;
  $("download").onclick = () => chrome.downloads ? chrome.downloads.download({ url, filename: name }) : Object.assign(document.createElement("a"), { href: url, download: name }).click();
  $("discard").onclick = async () => {
    await deleteRecording(key);
    window.close();
  };
  $("share").onclick = () => share(saved.blob, name).catch((e) => ($("status").textContent = String(e.message || e)));
}

/** Same steps as the desktop app: create the link, upload parts, complete. */
async function share(blob, title) {
  const { server, token } = await chrome.storage.local.get({ server: "https://umi.cam", token: "" });
  if (!token) {
    $("status").textContent = "Add your Umi Cloud token below first.";
    $("token").focus();
    return;
  }
  const api = async (method, path, body) => {
    const res = await fetch(server + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Umi Cloud answered ${res.status}`);
    return data;
  };
  $("status").textContent = "Creating the link…";
  const duration = await new Promise((ok) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => ok(Number.isFinite(v.duration) ? v.duration : 0);
    v.src = URL.createObjectURL(blob);
  });
  const created = await api("POST", "/api/videos", { title: title.replace(/\.webm$/, ""), sizeBytes: blob.size, contentType: "video/webm", durationMs: Math.round(duration * 1000), width: $("video").videoWidth, height: $("video").videoHeight, allowDownload: true });
  $("url").value = created.video.url;
  $("link").hidden = false;
  await navigator.clipboard.writeText(created.video.url).catch(() => {});
  const { partSize, parts } = created.upload;
  const etags = [];
  let done = 0;
  for (const part of parts) {
    const chunk = blob.slice((part.partNumber - 1) * partSize, part.partNumber * partSize);
    const res = await fetch(part.url, { method: "PUT", body: chunk, headers: { "content-type": "video/webm" } });
    if (!res.ok) throw new Error("Upload failed. Check your connection and try again.");
    etags.push({ partNumber: part.partNumber, etag: res.headers.get("etag") || "" });
    done += chunk.size;
    $("status").textContent = `Uploading… ${Math.round((done / blob.size) * 100)}% · the link is already copied`;
  }
  await api("POST", `/api/videos/${created.video.id}/complete`, { parts: etags });
  $("status").textContent = "Ready. Anyone with the link can watch.";
}
$("copy").onclick = () => navigator.clipboard.writeText($("url").value);
