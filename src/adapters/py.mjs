/** Python adapter. Where an import lands is decided by the `sys.path`-like roots and by `__init__.py` re-exports, both inferred from the layout; config that names `roots` or `barrels` owns that decision outright, so a configured repo's payload cannot move. */
import path from "node:path";
import { withLines } from "./lex.mjs";

// Line-anchored, and matched against blanked text: a docstring saying "from x import y" is prose, not an edge.
const FROM = /^[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+(\([^)]*\)|.*)$/gm;
const IMPORT = /^[ \t]*import[ \t]+([A-Za-z_][\w.]*)/gm;

const symbolsOf = (clause) =>
  clause.replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());

/** Blank `#` comments and string bodies, preserving length and newlines so match offsets still name the right line. `keepStrings` keeps ordinary quoted strings; triple-quoted ones are blanked either way, being docstrings. */
function blank(text, keepStrings = false) {
  let out = "";
  let i = 0;
  const n = text.length;
  const keep = (c) => (c === "\n" ? "\n" : " ");
  while (i < n) {
    const c = text[i];
    if (c === "#") {
      while (i < n && text[i] !== "\n") { out += " "; i++; }
    } else if (c === '"' || c === "'") {
      const triple = text.slice(i, i + 3);
      const quote = triple === c.repeat(3) ? triple : c;
      const verbatim = keepStrings && quote.length === 1;
      out += verbatim ? quote : " ".repeat(quote.length);
      i += quote.length;
      while (i < n && text.slice(i, i + quote.length) !== quote) {
        // A backslash escape cannot end the string; consuming both characters is what stops `"\\"` from swallowing the rest of the file.
        if (text[i] === "\\" && i + 1 < n) {
          out += verbatim ? text.slice(i, i + 2) : keep(text[i]) + keep(text[i + 1]);
          i += 2;
          continue;
        }
        out += verbatim ? text[i] : keep(text[i]);
        i++;
      }
      if (i < n) { out += verbatim ? quote : " ".repeat(quote.length); i += quote.length; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}


const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** The directories that behave like `sys.path` entries: the first non-package ancestor of each package, plus a manifest directory and its `src/`. Deliberately not every directory, or a local `requests.py` would capture `import requests` from a file that could never reach it. */
function inferRoots(ctx) {
  const packages = new Set();
  for (const p of ctx.paths) if (path.posix.basename(p) === "__init__.py") packages.add(dirOf(p));

  const roots = new Set();
  for (const pkg of packages) {
    let top = pkg;
    while (packages.has(dirOf(top)) && dirOf(top) !== top) top = dirOf(top);
    roots.add(dirOf(top));
  }
  for (const p of ctx.all ?? []) {
    const base = path.posix.basename(p);
    if (base !== "pyproject.toml" && base !== "setup.py") continue;
    const dir = dirOf(p);
    roots.add(dir);
    // PEP 517 src-layout: the manifest sits beside `src/`, not on sys.path itself.
    const src = dir ? `${dir}/src` : "src";
    if (ctx.paths.some((q) => q.startsWith(src + "/"))) roots.add(src);
  }
  // Longest first, so the most specific root claims a module first; sorted, because two runs of one input must be byte-identical.
  return [...roots].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** `pkg.sub.mod` under a root -> the module file, or the package's `__init__.py`. */
function fileForModule(root, mod, ctx) {
  const stem = [root, ...mod.split(".")].filter(Boolean).join("/");
  // Module file before package: `from app.controllers import document_controller` names a module, not a symbol.
  if (ctx.fileSet.has(`${stem}.py`)) return `${stem}.py`;
  if (ctx.fileSet.has(`${stem}/__init__.py`)) return `${stem}/__init__.py`;
  return null;
}

/** A relative import can only name a file in this repo, so it is internal or unresolved, never external; one dot is the importing file's package and each further dot climbs a level. */
function resolveRelative(from, dots, mod, ctx, symbols) {
  let base = dirOf(from);
  for (let i = 1; i < dots.length; i++) {
    if (!base) return { kind: "unresolved", ids: [dots + mod] };   // climbed past the repo root
    base = dirOf(base);
  }
  if (mod) {
    const hit = fileForModule(base, mod, ctx);
    if (hit) return { kind: "internal", ids: [hit] };
    return { kind: "unresolved", ids: [`${dots}${mod}`] };
  }

  // `from . import x` names no module, so the imported symbols are the candidates: a submodule where one exists, otherwise a name the package's `__init__.py` defines.
  const ids = [];
  for (const s of symbols ?? []) {
    const hit = fileForModule(base, s, ctx);
    if (hit) ids.push(hit);
  }
  if (ids.length) return { kind: "internal", ids: [...new Set(ids)] };
  const init = base ? `${base}/__init__.py` : "__init__.py";
  if (ctx.fileSet.has(init)) return { kind: "internal", ids: [init] };
  return { kind: "unresolved", ids: [dots] };
}

/** Module -> file, before any barrel re-targeting. */
function resolveModule(from, mod, ctx) {
  const cfg = ctx.config.python ?? {};
  const roots = cfg.roots ?? {};
  const svc = Object.keys(roots).find((r) => from.startsWith(r + "/"));
  const viaModule = Object.entries(cfg.moduleRoots ?? {}).find(([m]) => mod.startsWith(m))?.[1];
  const configured = viaModule ?? (svc ? roots[svc] : null);

  // A config that names roots owns the decision; inference fills the gap only where it said nothing.
  const candidates = configured != null ? [configured] : (ctx.py?.roots ?? []);
  for (const root of candidates) {
    const hit = fileForModule(root, mod, ctx);
    if (hit) return { kind: "internal", ids: [hit] };
  }

  // `from conftest import ...` — pytest inserts the rootdir on sys.path.
  if (svc && cfg.testDir && !mod.includes(".")) {
    const t = `${svc}/${cfg.testDir}/${mod}.py`;
    if (ctx.fileSet.has(t)) return { kind: "internal", ids: [t] };
  }

  // A module that must exist in-repo but did not resolve is a scanner gap, not a package — claimed by the `internal` pattern, or structurally when the top-level name is one this repo defines.
  if (cfg.internal?.test(mod)) return { kind: "unresolved", ids: [mod] };
  const top = mod.split(".")[0];
  if (!cfg.internal && (ctx.py?.roots ?? []).some((r) => fileForModule(r, top, ctx))) {
    return { kind: "unresolved", ids: [mod] };
  }
  return { kind: "external", ids: [top] };
}

/** Imported specifiers with the local names they bind, so path derivation can tell which import an endpoint touches instead of taking the whole list. */
function importBindings(text) {
  const clean = blank(text, true);
  const out = [];
  const FROM = /^[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm;
  for (const m of clean.matchAll(FROM)) {
    const spec = (m[1] ?? "") + (m[2] ?? "");
    const localNames = new Set();
    const symbols = [];
    for (const part of m[3].replace(/[()]/g, "").split(",")) {
      const s = part.trim();
      if (!s) continue;
      const bits = s.split(/\s+as\s+/);
      symbols.push(bits[0].trim());
      localNames.add((bits[1] ?? bits[0]).trim());
    }
    out.push({ spec, localNames, symbols });
  }
  const IMPORT = /^[ \t]*import[ \t]+([A-Za-z_][\w.]*)(?:[ \t]+as[ \t]+(\w+))?/gm;
  for (const m of clean.matchAll(IMPORT)) {
    out.push({ spec: m[1], localNames: new Set([m[2] ?? m[1].split(".")[0]]) });
  }
  return out;
}

export default {
  id: "py",
  extensions: [".py"],
  blankComments: (text) => blank(text, true),
  importBindings,

  /** The source file a test conventionally covers: test/test_x.py -> app/x.py. */
  testSubject: (p) => p.replace("/test/", "/app/").replace(/(^|\/)test_([^/]+)\.py$/, "$1$2.py"),

  /** A barrel re-export means one specifier names many files, so `from lib import X, Y` points at the modules defining X and Y. Every `__init__.py` is a candidate unless a config named the barrels. */
  prepare(ctx) {
    const py = { roots: inferRoots(ctx) };
    const declared = ctx.config.python?.barrels;
    const barrels = new Set(declared ?? ctx.paths.filter((p) => path.posix.basename(p) === "__init__.py"));

    // Keyed by barrel, not by symbol alone: two packages routinely re-export the same name, and a repo-wide table would cross them over.
    const barrelMap = new Map();
    // Barrel-building needs the roots just inferred, which are not on `ctx` yet, so it reads a copy rather than mutating the caller's ctx.
    const withRoots = { ...ctx, py };
    for (const barrel of barrels) {
      const text = ctx.src.get(barrel);
      if (!text) continue;
      const byName = new Map();
      for (const m of blank(text).matchAll(FROM)) {
        const dots = m[1], mod = m[2] ?? "";
        const target = dots
          ? resolveRelative(barrel, dots, mod, withRoots, symbolsOf(m[3]))
          : resolveModule(barrel, mod, withRoots);
        if (target.kind !== "internal") continue;
        for (const name of symbolsOf(m[3])) if (name) byName.set(name, target.ids[0]);
      }
      if (byName.size) barrelMap.set(barrel, byName);
    }
    return { ...py, barrels, barrelMap };
  },

  extractImports(text) {
    const blanked = blank(text);
    const matches = [];
    for (const m of blanked.matchAll(FROM)) {
      matches.push({ index: m.index, spec: (m[1] ?? "") + (m[2] ?? ""), symbols: symbolsOf(m[3]), kind: "static" });
    }
    for (const m of blanked.matchAll(IMPORT)) matches.push({ index: m.index, spec: m[1], kind: "static" });
    return withLines(text, matches);
  },

  resolve(from, spec, ctx, symbols) {
    const dots = spec.match(/^\.*/)[0];
    const mod = spec.slice(dots.length);
    const r = dots ? resolveRelative(from, dots, mod, ctx, symbols) : resolveModule(from, mod, ctx);

    // Re-target through a barrel to the module defining the symbol; a symbol the barrel does not re-export stays on the barrel, since it may be defined there.
    const names = ctx.py?.barrelMap.get(r.kind === "internal" ? r.ids[0] : null);
    if (names && symbols?.length) {
      // Deduped but not sorted: source order is already deterministic, and sorting would only churn edge order.
      const retargets = symbols.map((s) => names.get(s)).filter(Boolean);
      if (retargets.length) return { kind: "internal", ids: [...new Set(retargets)] };
    }
    return r;
  },
};
