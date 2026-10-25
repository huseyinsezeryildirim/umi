// Recordings in the browser: kept in this browser's storage (IndexedDB), never uploaded.
// A recording is what a bundle folder is on the Mac: project.json, cursor.json and files
// (screen.webm, camera.webm, images, music, voiceovers) by name.

export type StoredRecording = {
  id: string;
  createdAt: string;
  /** project.json (the edit inside). */
  project: Record<string, unknown>;
  cursor?: Record<string, unknown>;
  /** Length of the screen video. */
  mediaDuration: number;
};

const account = new URLSearchParams(location.search).get("account") ?? "local";
let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((done, fail) => {
    // One database per account on this browser.
    const req = indexedDB.open(`umi-${account}`, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("recordings", { keyPath: "id" });
      d.createObjectStore("files");
    };
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((done, fail) => {
        const req = work(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => done(req.result);
        req.onerror = () => fail(req.error);
      }),
  );
}

export const listRecordings = () => run<StoredRecording[]>("recordings", "readonly", (s) => s.getAll());
export const getRecording = (id: string) => run<StoredRecording | undefined>("recordings", "readonly", (s) => s.get(id));
export const putRecording = (r: StoredRecording) => run("recordings", "readwrite", (s) => s.put(r));

export const getFile = (id: string, name: string) => run<Blob | undefined>("files", "readonly", (s) => s.get(`${id}/${name}`));
export const putFile = (id: string, name: string, blob: Blob) => run("files", "readwrite", (s) => s.put(blob, `${id}/${name}`));

/** Names of a recording's files. */
export async function fileNames(id: string): Promise<string[]> {
  const keys = await run<IDBValidKey[]>("files", "readonly", (s) => s.getAllKeys(IDBKeyRange.bound(`${id}/`, `${id}/￿`)));
  return keys.map((k) => String(k).slice(id.length + 1));
}

export async function deleteRecording(id: string) {
  await run("files", "readwrite", (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)));
  await run("recordings", "readwrite", (s) => s.delete(id));
}

/** A name not used yet in the recording, like the Mac's bundle import. */
export async function freeName(id: string, base: string, extension: string) {
  const names = new Set(await fileNames(id));
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.${extension}` : `${base}-${i}.${extension}`;
    if (!names.has(name)) return name;
  }
}
