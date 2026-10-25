import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "@umi/ui";
import type { Editor } from "../store";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "heic", "webp", "gif"];
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv"];
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "aiff", "flac", "ogg"];

/** Asks for a file and copies it into the recording; returns its name in the bundle. */
export async function chooseIntoBundle(ed: Editor, title: string, extensions: string[], base: string): Promise<{ name: string; source: string } | null> {
  const picked = await open({ title, multiple: false, filters: [{ name: title, extensions }] });
  if (typeof picked !== "string") return null;
  return importIntoBundle(ed, picked, base);
}

/** Copies a file into the recording; returns its name in the bundle. */
export async function importIntoBundle(ed: Editor, file: string, base: string): Promise<{ name: string; source: string } | null> {
  try {
    const name = await invoke<string>("bundle_import", { bundle: ed.state().recording.bundle, file, base });
    return { name, source: file };
  } catch (e) {
    toast(String(e));
    return null;
  }
}

/** Full path of a file the edit names (bundle-relative or absolute). */
export function bundlePath(ed: Editor, name: string) {
  return name.startsWith("/") || /^[a-zA-Z]:\\/.test(name) ? name : `${ed.state().recording.bundle}/${name}`;
}

export function extensionOf(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}
