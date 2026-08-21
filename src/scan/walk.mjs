/**
 * File walk and filter.
 *
 * Symlinks are skipped: `readdirSync(withFileTypes)` uses lstat semantics, so a
 * symlinked entry is neither isFile() nor isDirectory() and falls through. That
 * is deliberate rather than incidental — a symlinked checkout would otherwise be
 * counted twice, and Phase 7 serves files only from the set this produces, so a
 * symlink that never enters the set can never be served through one.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Excluded directories are not descended into, rather than walked and filtered
 * afterwards. On a ref scan that is a small saving; on a worktree scan it is the
 * difference between reading the repository and reading every dependency it has
 * ever installed.
 */
function walk(dir, base = "", skip = []) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (skip.some((re) => re.test(rel + "/"))) continue;
      out.push(...walk(path.join(dir, e.name), rel, skip));
    } else if (e.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Walk, filter, and read. Sorting the full list before filtering is what makes
 * node and edge order deterministic, which is what makes the golden diffs work.
 */
export function collect(dir, { keep, exclude = [] }) {
  const all = walk(dir, "", exclude).sort();
  const paths = all.filter((p) => keep.test(p) && !exclude.some((re) => re.test(p)));
  return {
    all,
    paths,
    fileSet: new Set(paths),
    src: new Map(paths.map((p) => [p, readFileSync(path.join(dir, p), "utf8")])),
  };
}
