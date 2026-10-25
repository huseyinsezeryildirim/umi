import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@umi/ui";
import { recorder } from "./api";

/**
 * Runs in the main window: starting (countdown while the sources warm up), pausing,
 * stopping (open the editor, or export and copy in Instant mode) and discarding, whether
 * asked from the launcher, the control bar, the tray or a global shortcut.
 */
export function installRecordingFlow(openRecording: (bundle: string) => void) {
  let busy = false;
  /** The Instant link being reserved for the current recording (null: none). */
  let reserved: Promise<string | null> = Promise.resolve(null);

  const start = async () => {
    if (busy) return;
    const status = await recorder.status();
    if (status.recording) return stop();
    busy = true;
    const settings = await recorder.settings();
    try {
      await recorder.hide("launcher");
      // The bubble is up before the screen capture starts, so it's left out from the first frame
      // (the camera is recorded on its own and added in the editor).
      if (settings.cameraOn || settings.cameraOnly) await recorder.show("bubble");
      if (settings.notesOn) await recorder.show("prompter");
      // The countdown starts at once; the screen, camera and microphone warm up meanwhile.
      let failed: unknown = null;
      const prepared = invoke("record_prepare").catch((e) => {
        failed = e;
      });
      if (settings.countdown) {
        await recorder.show("countdown");
        for (const n of [3, 2, 1]) {
          if (failed) break;
          await emit("countdown", n);
          await new Promise((r) => setTimeout(r, 1000));
        }
        await recorder.hide("countdown");
      }
      await prepared;
      if (failed) throw failed;
      await invoke("record_begin");
      if (settings.flow === "instant") reserved = invoke<string | null>("instant_reserve").catch(() => null);
      await recorder.show("controls");
    } catch (e) {
      await recorder.hide("countdown");
      await invoke("record_cancel").catch(() => {});
      if (String(e).includes("SCREEN_PERMISSION")) {
        // Back to the launcher, which shows how to allow it.
        await recorder.hide("prompter").catch(() => {});
        await recorder.show("launcher");
        toast("Umi needs permission to record your screen. Allow it in System Settings, then press Start again.");
      } else {
        toast(`Couldn't start recording: ${e}`);
        await recorder.show("main");
      }
    } finally {
      busy = false;
    }
  };

  const stop = async () => {
    if (busy) return;
    busy = true;
    try {
      const settings = await recorder.settings();
      await recorder.hide("controls");
      await recorder.hide("bubble");
      await recorder.hide("prompter");
      await recorder.hide("ink");
      await emit("ink:mode", { drawing: false });
      const bundle = await invoke<string>("record_stop");
      if (settings.flow === "instant") {
        await instant(bundle);
      } else {
        await recorder.show("main");
        openRecording(bundle);
      }
    } catch (e) {
      toast(`Couldn't finish the recording: ${e}`);
    } finally {
      busy = false;
    }
  };

  const discard = async () => {
    await recorder.hide("controls");
    await recorder.hide("bubble");
    await recorder.hide("prompter");
    await recorder.hide("ink");
    await emit("ink:mode", { drawing: false });
    await invoke("record_cancel");
    reserved = Promise.resolve(null);
    void invoke("instant_release");
    toast("Recording discarded");
  };

  const pause = async () => {
    const status = await recorder.status();
    if (status.recording) await invoke("record_pause", { paused: !status.paused });
  };

  /**
   * Instant: a polished 1080p MP4 with the default look. With Umi Cloud the link (reserved
   * when recording started) is copied at once and the video uploads while it's made;
   * otherwise the file itself is copied to the clipboard.
   */
  const instant = async (bundle: string) => {
    await recorder.show("main");
    const link = await reserved;
    reserved = Promise.resolve(null);
    if (link) {
      await invoke("copy_text_to_clipboard", { text: link });
      toast("Link copied — it plays as soon as the upload finishes");
    } else toast("Preparing your video…");
    const state = await invoke<{ id: string; name: string }>("open_editor", { path: bundle });
    const destination = await invoke<string>("export_default_path", { name: state.name, extension: "mp4" });
    const { Channel } = await import("@tauri-apps/api/core");
    if (link) {
      try {
        await invoke("instant_share", { id: state.id, destination, progress: new Channel() });
        toast("Your video is live");
      } catch (e) {
        toast(`Upload failed: ${e}. The video is saved in Exports.`);
      }
    } else {
      await invoke("editor_export", { id: state.id, request: { format: "mp4", resolution: 1080, fps: 60, destination }, progress: new Channel<number>() });
      await invoke("copy_file_to_clipboard", { path: destination });
      toast("Video copied — paste it anywhere");
    }
    openRecording(bundle);
  };


  void listen("record:start", () => void start());
  void listen("record:stop", () => void stop());
  void listen("record:discard", () => void discard());
  void listen("record:pause", () => void pause());
  let inking = false;
  void listen<{ drawing: boolean }>("ink:mode", (e) => (inking = e.payload.drawing));
  void listen<string>("shortcut", (e) => {
    if (e.payload === "record") void start();
    if (e.payload === "pause") void pause();
    if (e.payload === "discard") void discard();
    if (e.payload === "draw") void recorder.status().then((s) => s.recording && invoke("ink_set", { drawing: !inking }));
  });
  void listen<number>("recovered", (e) => toast(e.payload === 1 ? "Recovered a recording from last time" : `Recovered ${e.payload} recordings from last time`));
}
