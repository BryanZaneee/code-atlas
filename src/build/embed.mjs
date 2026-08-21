/** `--embed-source`: bake the scanned text into the payload, drawn from `collect()`'s already-sorted set so the embedded files and the map agree and key order stays deterministic. `--gzip-source` compresses them as one shared blob, since DEFLATE's 32 KB dictionary is what lets one file help compress the next; `paths` ships uncompressed so the viewer can answer "is this embedded" without inflating anything. */
import { gzipSync } from "node:zlib";
import { globToRe } from "../model/tests.mjs";

export function embedSourceFiles({ paths, src, glob = null, gzip = false }) {
  const re = glob ? globToRe(glob) : null;
  const kept = re ? paths.filter((p) => re.test(p)) : paths;

  const files = {};
  for (const p of kept) {
    const text = src.get(p);
    if (text == null) continue; // not in `src` at all: keep() excluded it upstream
    files[p] = text;
  }

  const embeddedPaths = Object.keys(files);
  if (!gzip) return { glob, gzip: false, paths: embeddedPaths, files };

  const blob = gzipSync(JSON.stringify(files), { level: 9 }).toString("base64");
  return { glob, gzip: true, paths: embeddedPaths, blob };
}
