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

  const start = async () => {
    if (busy) return;
    const status = await recorder.status();
    if (status.recording) return stop();
    busy = true;
    const settings = await recorder.settings();
    try {
      await recorder.hide("launcher");
      if (settings.notesOn) await recorder.show("prompter");
      await invoke("record_prepare");
      if (settings.countdown) {
        await recorder.show("countdown");
        for (const n of [3, 2, 1]) {
          await emit("countdown", n);
          await new Promise((r) => setTimeout(r, 1000));
        }
        await recorder.hide("countdown");
      }
      await invoke("record_begin");
      await recorder.show("controls");
      if (settings.cameraOn || settings.cameraOnly) await recorder.show("bubble");
    } catch (e) {
      await recorder.hide("countdown");
      await invoke("record_cancel").catch(() => {});
      toast(`Couldn't start recording: ${e}`);
      await recorder.show("main");
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
    toast("Recording discarded");
  };

  const pause = async () => {
    const status = await recorder.status();
    if (status.recording) await invoke("record_pause", { paused: !status.paused });
  };

  /** Instant: a polished 1080p MP4 with the default look, copied to the clipboard. */
  const instant = async (bundle: string) => {
    await recorder.show("main");
    toast("Preparing your video…");
    const state = await invoke<{ id: string; name: string }>("open_editor", { path: bundle });
    const destination = await invoke<string>("export_default_path", { name: state.name, extension: "mp4" });
    const { Channel } = await import("@tauri-apps/api/core");
    await invoke("editor_export", { id: state.id, request: { format: "mp4", resolution: 1080, fps: 60, destination }, progress: new Channel<number>() });
    await invoke("copy_file_to_clipboard", { path: destination });
    toast("Video copied — paste it anywhere");
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
