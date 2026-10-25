// Cloudflare Pages serves files up to 25 MiB. The web editor bundles a few bigger ones (onnxruntime's
// wasm builds), which are byte-for-byte copies of files in npm packages: this swaps each for a redirect
// to the same file on jsDelivr, after checking the hashes match. Run on the built site before uploading:
//   node apps/site/scripts/pages-large-files.mjs apps/site/out
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT = 25 * 1024 * 1024;
const out = process.argv[2] ?? "out";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const store = join(root, "node_modules/.pnpm");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

/** The npm file a bundled asset was copied from (Vite adds -<hash> before the extension). */
function source(path) {
  const name = basename(path).replace(/-[A-Za-z0-9_-]{8}(\.[^.]+)$/, "$1");
  const size = statSync(path).size;
  const want = sha(readFileSync(path));
  for (const candidate of files(store)) {
    if (basename(candidate) !== name || statSync(candidate).size !== size || sha(readFileSync(candidate)) !== want) continue;
    let dir = dirname(candidate);
    while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { url: `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/${relative(dir, candidate).split(sep).join("/")}`, want };
  }
  return null;
}

let failed = false;
for (const path of [...files(out)].filter((p) => statSync(p).size > LIMIT)) {
  const route = "/" + relative(out, path).split(sep).join("/");
  const found = source(path);
  if (!found) {
    console.error(`::error::${route} is over 25 MiB and isn't a copy of an npm file; Cloudflare Pages can't serve it.`);
    failed = true;
    continue;
  }
  const response = await fetch(found.url);
  if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== found.want) {
    console.error(`::error::${found.url} doesn't match ${route}.`);
    failed = true;
    continue;
  }
  rmSync(path);
  appendFileSync(join(out, "_redirects"), `${route} ${found.url} 302\n`);
  console.log(`${route} → ${found.url}`);
}
process.exit(failed ? 1 : 0);
