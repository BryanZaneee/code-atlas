/**
 * `--embed-source`: bake the scanned repository's own text into the payload.
 *
 * Draws from `paths`/`src` — the exact set `collect()` in `src/scan/walk.mjs`
 * already produced, the same one `atlas serve`'s allowlist is built from — so
 * the embedded set and the map agree by construction, and no file is read
 * twice. `glob` narrows it further with the same glob syntax `suiteConfigs`
 * already uses (`src/model/tests.mjs`'s `globToRe`); omitted, the whole
 * scanned set is embedded.
 *
 * `paths` arrives pre-sorted from `collect()`, so `files`/`paths` below are
 * built in that order and their key order is therefore deterministic —
 * required for the byte-identical build gate the payload as a whole is held
 * to.
 *
 * `--gzip-source` compresses every kept file's text **as one shared blob**,
 * not one gzip stream per file: DEFLATE's dictionary is only the last 32 KB
 * it has seen, so one blob is what actually lets one file's redundancy help
 * compress the next, and it pays gzip's ~18-byte header/footer once instead
 * of once per file. `paths` still ships uncompressed alongside it — a plain
 * array of strings, small next to the content — so the viewer can answer "is
 * this file embedded" and count files for the footer badge without inflating
 * anything.
 */
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
