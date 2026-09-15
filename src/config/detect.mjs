/** Service detection: a directory with a package manifest is a service, filtered so a vendored manifest or an empty workspace root cannot register one. */
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

/** An id that reads on a map: the package name minus scope, else the directory. */
function idFor(declared, dir) {
  const base = declared?.split("/").pop() || dir.split("/").pop() || "app";
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
}

/** `all` is the unfiltered walk (manifests are never drawn), `paths` the kept files. */
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
      // A malformed manifest still marks a service; only its name is lost.
    }
    found.push({ dir: d, lang: m.lang, declared });
  }

  // Deepest first: a nested package owns its files, not the workspace root.
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
    // Two manifests can share a name; the directory distinguishes them, a numeric suffix would not.
    let id = idFor(f.declared, f.dir);
    if (used.has(id)) id = idFor(null, f.dir);
    while (used.has(id)) id += `-${order}`;
    used.add(id);
    return {
      id,
      label: id.toUpperCase().replace(/-/g, " "),
      lang: f.lang,
      // A root manifest owns whatever no deeper one claims: a rootless service.
      root: f.dir || null,
      order,
    };
  });
}
