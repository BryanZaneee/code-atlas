/**
 * Python adapter.
 *
 * Two things decide where a Python import lands: which directories are on
 * `sys.path`, and what a package's `__init__.py` re-exports. Both used to be
 * hand-written config, which meant a repository with no config resolved
 * nothing at all. Both are now derived from the layout, and config still wins
 * outright wherever it is given — a config that names `roots` or `barrels` owns
 * that decision completely, so an existing config's payload cannot move
 * underneath it.
 *
 * Relative-dot imports are the other half. The old pattern required a letter
 * after `from`, so `from .foo import x` and `from . import y` could not match
 * at all — not "resolved to nothing", never seen.
 */
import path from "node:path";

// Line-anchored, and matched against blanked text: a docstring saying
// "from x import y" is prose, not an edge.
const FROM = /^[ \t]*from[ \t]+(\.*)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+(\([^)]*\)|.*)$/gm;
const IMPORT = /^[ \t]*import[ \t]+([A-Za-z_][\w.]*)/gm;

const symbolsOf = (clause) =>
  clause.replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());

/**
 * Blank `#` comments and every string body, preserving length and newlines so a
 * match offset still names the right line. Unlike the TypeScript side, string
 * contents are blanked rather than kept: no Python import syntax puts a module
 * name inside quotes, so nothing is lost — and a triple-quoted docstring is the
 * single most common place to find text that looks exactly like an import.
 */
/**
 * Blank `#` comments and string bodies. `keepStrings` leaves ordinary quoted
 * strings intact — triple-quoted ones are blanked either way, being docstrings.
 */
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
        // A backslash escape cannot end the string, and consuming both
        // characters is what stops `"\\"` from swallowing the rest of the file.
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

/** Line of a byte offset, walked once forward across matches sorted by index. */
function withLines(text, matches) {
  matches.sort((a, b) => a.index - b.index);
  let line = 1, pos = 0;
  return matches.map((m) => {
    while (pos < m.index) { if (text[pos] === "\n") line++; pos++; }
    const { index, ...rest } = m;
    return { ...rest, line };
  });
}

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * The directories that behave like `sys.path` entries for this repository.
 *
 * A package is a directory holding `__init__.py`; the entry that makes it
 * importable is the first ancestor that is NOT itself a package, which is
 * exactly how Python finds a top-level package name. A manifest directory and
 * its `src/` are added too, for the flat layout that has modules but no
 * packages.
 *
 * Deliberately not "every directory": that is the phantom-edge trap here. If
 * any directory were a root, a local `requests.py` three levels down would
 * capture `import requests` from a file that could never have imported it.
 */
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
  // Longest first, so the most specific root claims a module before a shallower
  // one can. Sorted, because two runs of one input must be byte-identical.
  return [...roots].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** `pkg.sub.mod` under a root -> the module file, or the package's `__init__.py`. */
function fileForModule(root, mod, ctx) {
  const stem = [root, ...mod.split(".")].filter(Boolean).join("/");
  // Module file before package: `from app.controllers import document_controller`
  // names a module, not a symbol.
  if (ctx.fileSet.has(`${stem}.py`)) return `${stem}.py`;
  if (ctx.fileSet.has(`${stem}/__init__.py`)) return `${stem}/__init__.py`;
  return null;
}

/**
 * A relative import can only ever name a file in this repository, so it is
 * internal or unresolved — never external. One dot is the importing file's own
 * package, each further dot climbs one level.
 */
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

  // `from . import x` names no module, so the imported symbols are the module
  // candidates: `x` is a submodule where one exists, and otherwise a name the
  // package's own `__init__.py` defines or re-exports.
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

  // A config that names roots owns the decision; inference fills the gap only
  // where it said nothing, so a configured repository's payload cannot move.
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

  // A module that must exist in-repo but did not resolve is a gap in the
  // scanner, not a third-party package. Saying so is the whole point. With no
  // `internal` pattern configured, the same claim is made structurally: the
  // top-level name is one this repository defines, so a miss is ours.
  if (cfg.internal?.test(mod)) return { kind: "unresolved", ids: [mod] };
  const top = mod.split(".")[0];
  if (!cfg.internal && (ctx.py?.roots ?? []).some((r) => fileForModule(r, top, ctx))) {
    return { kind: "unresolved", ids: [mod] };
  }
  return { kind: "external", ids: [top] };
}

export default {
  id: "py",
  extensions: [".py"],
  blankComments: (text) => blank(text, true),

  /**
   * A barrel re-export means one specifier names many files: consumers of
   * `from lib import X, Y` should point at the modules defining X and Y, not
   * collapse onto the barrel. Every `__init__.py` is a candidate — that is what
   * the file is for — unless a config named the barrels, in which case it owns
   * the list. Built once, before extraction.
   */
  prepare(ctx) {
    const py = { roots: inferRoots(ctx) };
    const declared = ctx.config.python?.barrels;
    const barrels = new Set(declared ?? ctx.paths.filter((p) => path.posix.basename(p) === "__init__.py"));

    // Keyed by barrel, not by symbol alone: two packages routinely re-export
    // the same name, and a repo-wide symbol table would cross them over.
    const barrelMap = new Map();
    // Resolution during barrel-building needs the roots that were just
    // inferred, and `prepare`'s return value is not on `ctx` yet — so it reads
    // a copy carrying them rather than mutating the caller's ctx behind its back.
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

    // Re-target through a barrel: `from pkg import Thing` points at the module
    // that defines Thing, not at the `__init__.py` that merely passes it along.
    // A symbol the barrel does not re-export is left on the barrel rather than
    // guessed at — it may be defined there.
    const names = ctx.py?.barrelMap.get(r.kind === "internal" ? r.ids[0] : null);
    if (names && symbols?.length) {
      // Deduped but NOT sorted: the symbols are already in source order, which
      // is deterministic and is the order the modules were asked for. Sorting
      // would only churn edge order in the payload for no reader's benefit.
      const retargets = symbols.map((s) => names.get(s)).filter(Boolean);
      if (retargets.length) return { kind: "internal", ids: [...new Set(retargets)] };
    }
    return r;
  },
};
