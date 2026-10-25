// Recordings waiting on the result page (IndexedDB: big files, survives the worker).
const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open("umi", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("recordings");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function saveRecording(blob) {
  const db = await open();
  const key = `rec-${Date.now()}`;
  await new Promise((ok, fail) => {
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").put({ blob, at: Date.now() }, key);
    tx.oncomplete = ok;
    tx.onerror = () => fail(tx.error);
  });
  return key;
}

export async function loadRecording(key) {
  const db = await open();
  return new Promise((ok, fail) => {
    const req = db.transaction("recordings").objectStore("recordings").get(key);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

export async function deleteRecording(key) {
  const db = await open();
  db.transaction("recordings", "readwrite").objectStore("recordings").delete(key);
}
