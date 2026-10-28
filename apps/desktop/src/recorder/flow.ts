import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@umi/ui";
import { recorder } from "./api";

/**
 * Runs in the main window: starting (countdown while the sources warm up), pausing,
 * stopping (open the editor, or copy the link in Instant mode) and discarding, whether
 * asked from the launcher, the control bar, the tray or a global shortcut.
 *
 * Connected to Umi Cloud, every recording uploads while it's made (`live_start`), so its link
 * plays the moment recording stops; nothing is rendered on this computer for it.
 */
export function installRecordingFlow(openRecording: (bundle: string) => void) {
  let busy = false;
  /** The link being reserved for the current recording (null: not connected). */
  let reserved: Promise<string | null> = Promise.resolve(null);

  const start = async () => {
    if (busy) return;
    const status = await recorder.status();
    if (status.recording) return stop();
    busy = true;
    const settings = await recorder.settings();
    try {
      await recorder.hide("launcher");
      // Out of the way of what's being recorded.
      await recorder.hide("main");
      // The bubble is up before the screen capture starts, so it's left out from the first frame
      // (the camera is recorded on its own and added in the editor).
      if (settings.cameraOn || settings.cameraOnly) await recorder.show("bubble");
      if (settings.notesOn) await recorder.show("prompter");
      // A frame around what's recorded, so a wrong screen or window shows before it starts.
      await invoke("record_frame", { on: true }).catch(() => {});
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
      setTimeout(() => void invoke("record_frame", { on: false }), 400);
      reserved = invoke<string | null>("live_start", { camera: !!(settings.cameraOn || settings.cameraOnly) }).catch(() => null);
      await recorder.show("controls");
      // With the camera: the layout column on the right (screen and bubble, side by side…).
      if (settings.cameraOn && !settings.cameraOnly) await recorder.show("layouts");
      // The drawing tools along the bottom, starting with the pointer (clicks go to the apps).
      await emit("ink:pick", { tool: "pointer" });
      await recorder.show("draw");
    } catch (e) {
      await recorder.hide("countdown");
      await invoke("record_frame", { on: false }).catch(() => {});
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
      await recorder.hide("layouts");
      await recorder.hide("bubble");
      await recorder.hide("prompter");
      await recorder.hide("draw");
      await invoke("ink_spotlight", { on: false });
      await emit("ink:action", { action: "clear" });
      await recorder.hide("ink");
      await emit("ink:mode", { drawing: false });
      const bundle = await invoke<string>("record_stop");
      await reserved;
      reserved = Promise.resolve(null);
      const live = await invoke<{ url: string } | null>("live_finish", { bundle }).catch(() => null);
      if (settings.flow === "instant") {
        await instant(bundle, live?.url ?? null);
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
    await recorder.hide("layouts");
    await recorder.hide("bubble");
    await recorder.hide("prompter");
    await recorder.hide("draw");
    await invoke("ink_spotlight", { on: false });
    await emit("ink:action", { action: "clear" });
    await recorder.hide("ink");
    await emit("ink:mode", { drawing: false });
    await invoke("record_cancel");
    reserved = Promise.resolve(null);
    void invoke("live_cancel");
    await recorder.show("main");
    toast("Recording discarded");
  };

  const pause = async () => {
    const status = await recorder.status();
    if (status.recording) await invoke("record_pause", { paused: !status.paused });
  };

  /**
   * Instant: with Umi Cloud the link (uploaded while recording) is copied at once and plays in
   * seconds; otherwise a 1080p MP4 is made and the file itself is copied to the clipboard.
   */
  const instant = async (bundle: string, link: string | null) => {
    await recorder.show("main");
    if (link) {
      await invoke("copy_text_to_clipboard", { text: link });
      // Copying it is sharing it: the link is kept (within the plan's limits).
      const kept = await invoke("live_share", { bundle }).then(
        () => true,
        (e) => (toast(String(e)), false),
      );
      if (kept) toast("Link copied — paste it anywhere");
      openRecording(bundle);
      return;
    }
    // The recording opens at once; the video is made alongside and copied when it's ready.
    openRecording(bundle);
    toast("Preparing your video — it's copied when it's ready");
    // Not awaited: the next recording can start meanwhile.
    void (async () => {
      const state = await invoke<{ id: string; name: string }>("open_editor", { path: bundle });
      const destination = await invoke<string>("export_default_path", { name: state.name, extension: "mp4" });
      const { Channel } = await import("@tauri-apps/api/core");
      await invoke("editor_export", { id: state.id, request: { format: "mp4", resolution: 1080, fps: 60, destination }, progress: new Channel<number>() });
      await invoke("copy_file_to_clipboard", { path: destination });
      toast("Video copied — paste it anywhere");
    })().catch((e) => toast(`Couldn't make the video: ${e}`));
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
    // The draw shortcut: the pen, or back to the pointer.
    if (e.payload === "draw")
      void recorder.status().then((s) => {
        if (s.recording) void emit("ink:pick", { tool: inking ? "pointer" : "pen" });
      });
  });
  void listen<number>("recovered", (e) => toast(e.payload === 1 ? "Recovered a recording from last time" : `Recovered ${e.payload} recordings from last time`));
}
