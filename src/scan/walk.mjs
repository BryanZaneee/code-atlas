/** File walk and filter. Symlinks fall through `readdirSync(withFileTypes)`'s lstat semantics deliberately: `serve` hands back only files from this set, so a symlink never in it can never be served through one. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Excluded directories are not descended into: on a worktree scan that is the difference between reading the repository and reading every dependency in it. */
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

/** Walk, filter, and read. Sorting before filtering is what makes node and edge order deterministic, and the golden diffs with it. */
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
