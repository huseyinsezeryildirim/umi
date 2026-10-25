// Hands a finished recording to the editor (/editor, the Mac app's editor running on the web):
// it goes into this browser's storage (IndexedDB), the same place the editor's library reads.
// Nothing is uploaded.
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat } from "mediabunny";

/** The bubble's shapes in the recorder ("rounded" is the editor's "squircle"). */
export type CameraShape = "circle" | "rounded" | "square";
export type Corner = "tl" | "tr" | "bl" | "br";

export type Take = {
  screen: Blob;
  camera: Blob | null;
  duration: number;
  width: number;
  height: number;
  /** How the camera bubble looked while recording. */
  corner?: Corner;
  camSize?: number;
  camShape?: CameraShape;
  mirror?: boolean;
  camBg?: "none" | "blur" | "remove";
  /** Where the camera was turned off while recording (seconds). */
  cameraOff?: [number, number][];
  /** The shared window's title, when the browser says it (names the recording). */
  windowTitle?: string;
};

function open(account: string): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const req = indexedDB.open(`umi-${account}`, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("recordings", { keyPath: "id" });
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
}

/**
 * Browsers write recordings without an index, so seeking in them is slow and their length is
 * unknown. Rewriting the container (no re-encoding, quick) fixes both.
 */
async function seekable(blob: Blob): Promise<Blob> {
  try {
    // Same container, so nothing is re-encoded.
    const mp4 = blob.type.includes("mp4");
    const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({ input: new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) }), output });
    if (!conversion.isValid) return blob;
    await conversion.execute();
    return new Blob([output.target.buffer!], { type: mp4 ? "video/mp4" : "video/webm" });
  } catch {
    return blob;
  }
}

const CORNERS: Record<Corner, [number, number]> = { tl: [0.14, 0.2], tr: [0.86, 0.2], bl: [0.14, 0.8], br: [0.86, 0.8] };

/** Saves a take as a new recording; returns its id. */
export async function saveTake(account: string, take: Take): Promise<string> {
  const [screen, camera] = await Promise.all([seekable(take.screen), take.camera ? seekable(take.camera) : null]);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const project = {
    version: 1,
    createdAt,
    duration: take.duration,
    screen: { pixelWidth: take.width, pixelHeight: take.height, captureRect: [[0, 0], [take.width, take.height]], fps: 30 },
    ...(camera
      ? {
          camera: {
            bubble: {
              visible: true,
              shape: take.camShape === "rounded" ? "squircle" : (take.camShape ?? "circle"),
              size: take.camSize ?? 0.24,
              position: CORNERS[take.corner ?? "bl"],
              mirrored: take.mirror ?? true,
              ...(take.camBg && take.camBg !== "none" ? { background: take.camBg } : {}),
            },
          },
        }
      : {}),
    audio: { microphoneTrack: 0 },
    ...(camera && take.cameraOff?.length ? { cameraOff: take.cameraOff } : {}),
    ...(take.windowTitle ? { windows: [{ start: 0, app: "", title: take.windowTitle }] } : {}),
  };
  const db = await open(account);
  const files = [[screen, "screen.webm"], ...(camera ? [[camera, "camera.webm"]] : [])] as [Blob, string][];
  const write = async (asBytes: boolean) => {
    // Safari's private windows can't keep a Blob in IndexedDB: then the bytes go in as they are.
    const values = await Promise.all(files.map(async ([b]) => (asBytes ? { type: b.type, bytes: await b.arrayBuffer() } : b)));
    await new Promise<void>((done, fail) => {
      const tx = db.transaction(["recordings", "files"], "readwrite");
      // The editor knows the videos by these names whatever their format (the blob keeps its type).
      files.forEach(([, name], i) => tx.objectStore("files").put(values[i], `${id}/${name}`));
      tx.objectStore("recordings").put({ id, createdAt, project, mediaDuration: take.duration });
      tx.oncomplete = () => done();
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
    });
  };
  await write(false).catch(() => write(true));
  db.close();
  return id;
}
