/**
 * The source-read allowlist.
 *
 * Path traversal is defended by **set membership**, not by sanitising the
 * requested string. The scan already produced the exact set of files it kept
 * (`fileSet`, from `collect()` in `src/scan/walk.mjs`) — a request for anything
 * outside that set is not a string to clean up, it is simply not a key in the
 * set, so `..`, an absolute path, or a URL-encoded traversal all fail the same
 * way: `allow.has(rel)` is false.
 *
 * On top of membership: the resolved path is re-checked against the repo root,
 * and `lstatSync` (never `stat`) refuses anything that is — or has become — a
 * symlink, so a file swapped for a symlink after the scan ran is refused at
 * request time. `collect()`'s own walk already excludes symlinks from
 * `fileSet` in the first place; this is the second, independent layer.
 *
 * The one window it does not close is between the `lstat` and the read, which
 * would need an `open`/`fstat` pair to shut properly. Naming it rather than
 * implying it is closed: exploiting it needs write access to the repository
 * being served, and anyone holding that already owns the files this endpoint
 * would hand back.
 */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

/** A source file, not an asset — large enough for any real file, small enough to cap abuse. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * @returns the absolute path to read, or null if the request must be refused.
 */
export function resolveAllowed(repoDir, allow, rel) {
  if (typeof rel !== "string" || !allow.has(rel)) return null;

  const full = path.resolve(repoDir, rel);
  const root = path.resolve(repoDir);
  if (full !== path.join(root, rel)) return null;
  if (full !== root && !full.startsWith(root + path.sep)) return null;

  let st;
  try {
    st = lstatSync(full);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;

  return full;
}

export function readAllowed(full) {
  return readFileSync(full, "utf8");
}
