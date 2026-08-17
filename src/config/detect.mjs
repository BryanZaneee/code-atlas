/**
 * Service detection — the rows of the map, found rather than declared.
 *
 * A service is a directory that declares itself one by carrying a package
 * manifest. That is the only signal used, because it is the only one that means
 * the same thing everywhere: a directory with a manifest is a unit somebody
 * chose to version and install as a whole.
 *
 * Two rules keep it honest on real repositories:
 *
 *   - Manifests are looked for over the **excluded-filtered** file list, so a
 *     build artifact's vendored manifest cannot register as a service. This is
 *     why detection takes the full walk and applies `exclude` itself rather than
 *     reading the kept list: a manifest is not a file we draw, so `keep` never
 *     admits one.
 *   - A manifest directory with no source files under it is not a service. That
 *     drops the umbrella manifest at the root of a workspace repo, whose job is
 *     to list the others.
 *
 * A repo with no manifest anywhere is not a failure: it gets one unnamed
 * service, and renders.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Each manifest names its package differently; none of them is required to. */
const MANIFESTS = [
  { file: "package.json", lang: "ts", name: (t) => JSON.parse(t).name },
  { file: "pyproject.toml", lang: "py", name: (t) => t.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] },
  { file: "setup.py", lang: "py", name: (t) => t.match(/name\s*=\s*["']([^"']+)["']/)?.[1] },
  { file: "go.mod", lang: "go", name: (t) => t.match(/^module\s+(\S+)/m)?.[1] },
  { file: "Cargo.toml", lang: "rs", name: (t) => t.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] },
  { file: "pom.xml", lang: "java", name: (t) => t.match(/<artifactId>([^<]+)</)?.[1] },
  { file: "Gemfile", lang: "rb", name: () => null },
];

const MANIFEST_BY_FILE = new Map(MANIFESTS.map((m) => [m.file, m]));

/** `packages/core/package.json` -> `packages/core`; a root manifest -> `""`. */
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * An id that reads well on a map: the package's own name where it has one,
 * minus any npm scope, otherwise the directory it sits in.
 */
function idFor(declared, dir) {
  const base = declared?.split("/").pop() || dir.split("/").pop() || "app";
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
}

/**
 * @param all      every path from the walk, unfiltered — manifests are not
 *                 files we draw, so they never appear in the kept list
 * @param paths    the kept (drawn) files, used to decide which manifest
 *                 directories actually contain code
 * @param exclude  the exclusion patterns; this is the defense against a
 *                 vendored or generated manifest registering as a service
 */
export function detectServices({ dir, all, paths, exclude = [] }) {
  const excluded = (p) => exclude.some((re) => re.test(p));

  const found = [];
  const seenDirs = new Set();
  for (const p of all) {
    if (excluded(p)) continue;
    const m = MANIFEST_BY_FILE.get(p.split("/").pop());
    if (!m) continue;
    const d = dirOf(p);
    if (seenDirs.has(d)) continue;          // one service per directory
    seenDirs.add(d);
    let declared = null;
    try {
      declared = m.name(readFileSync(path.join(dir, p), "utf8"));
    } catch {
      // An unreadable or malformed manifest still marks a directory as a
      // service; only its name is lost, and the directory name covers that.
    }
    found.push({ dir: d, lang: m.lang, declared });
  }

  // Deepest first: a file under a nested package belongs to it, not to the
  // workspace root that also carries a manifest.
  found.sort((a, b) => b.dir.length - a.dir.length || a.dir.localeCompare(b.dir));

  const owns = new Map(found.map((f) => [f.dir, 0]));
  for (const p of paths) {
    const owner = found.find((f) => f.dir === "" || p.startsWith(f.dir + "/"));
    if (owner) owns.set(owner.dir, owns.get(owner.dir) + 1);
  }

  // A manifest directory with no files of its own is an umbrella, not a service.
  const live = found.filter((f) => owns.get(f.dir) > 0);
  if (!live.length) return null;

  // Presentation order is shallowest-first, which reads as outermost-first.
  live.sort((a, b) => a.dir.length - b.dir.length || a.dir.localeCompare(b.dir));

  const used = new Set();
  return live.map((f, order) => {
    // Two manifests can declare the same name — a Rust crate and an npm package
    // in one repo routinely do. The directory is what actually distinguishes
    // them, so it is the second choice rather than a numeric suffix nobody can
    // map back to anything.
    let id = idFor(f.declared, f.dir);
    if (used.has(id)) id = idFor(null, f.dir);
    while (used.has(id)) id += `-${order}`;
    used.add(id);
    return {
      id,
      label: id.toUpperCase().replace(/-/g, " "),
      lang: f.lang,
      // A manifest at the repository root owns everything not claimed by a
      // deeper one, which is exactly what a rootless service means.
      root: f.dir || null,
      order,
    };
  });
}
