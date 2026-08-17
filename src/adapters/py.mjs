/**
 * Python adapter.
 *
 * Module roots, the pytest-rootdir fallback and the re-export barrels are all
 * supplied by config (`config.python`) rather than known here — the example
 * configs under examples/ show the shape. Phase 3 derives them from the
 * pyproject/src layout instead, and adds relative-dot imports, which the
 * line-anchored FROM pattern below deliberately cannot match yet.
 */

// Line-anchored: whole-text matching picks up "import time:" inside a docstring.
const FROM = /^[ \t]*from[ \t]+([A-Za-z_][\w.]*)[ \t]+import[ \t]+(\([^)]*\)|.*)$/gm;
const IMPORT = /^[ \t]*import[ \t]+([A-Za-z_][\w.]*)/gm;

const symbolsOf = (clause) =>
  clause.replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());

/** Module -> file, before any barrel re-targeting. */
function resolveModule(from, mod, ctx) {
  const cfg = ctx.config.python ?? {};
  const roots = cfg.roots ?? {};
  const svc = Object.keys(roots).find((r) => from.startsWith(r + "/"));
  const viaModule = Object.entries(cfg.moduleRoots ?? {}).find(([m]) => mod.startsWith(m))?.[1];
  const root = viaModule ?? (svc ? roots[svc] : null);

  if (root) {
    const stem = [root, ...mod.split(".")].join("/");
    // module file before package: `from app.controllers import document_controller`
    // imports a module, not a symbol.
    if (ctx.fileSet.has(`${stem}.py`)) return { kind: "internal", ids: [`${stem}.py`] };
    if (ctx.fileSet.has(`${stem}/__init__.py`)) return { kind: "internal", ids: [`${stem}/__init__.py`] };
  }
  // `from conftest import ...` — pytest inserts the rootdir on sys.path.
  if (svc && cfg.testDir && !mod.includes(".")) {
    const t = `${svc}/${cfg.testDir}/${mod}.py`;
    if (ctx.fileSet.has(t)) return { kind: "internal", ids: [t] };
  }
  // A module that must exist in-repo but did not resolve is a gap in the
  // scanner, not a third-party package. Saying so is the whole point.
  if (cfg.internal?.test(mod)) return { kind: "unresolved", ids: [mod] };
  return { kind: "external", ids: [mod.split(".")[0]] };
}

export default {
  id: "py",
  extensions: [".py"],

  /**
   * A barrel re-export means one specifier names many files: consumers of
   * `from lib import X, Y` should point at the modules defining X and Y, not
   * collapse onto the barrel. Built once, before extraction.
   */
  prepare(ctx) {
    const map = new Map();
    const barrels = new Set(ctx.config.python?.barrels ?? []);
    for (const barrel of barrels) {
      const text = ctx.src.get(barrel);
      if (!text) continue;
      for (const m of text.matchAll(FROM)) {
        const target = resolveModule(barrel, m[1], ctx);
        if (target.kind !== "internal") continue;
        for (const name of symbolsOf(m[2])) if (name) map.set(name, target.ids[0]);
      }
    }
    return { barrels, barrelMap: map };
  },

  extractImports(text) {
    const out = [];
    for (const m of text.matchAll(FROM)) out.push({ spec: m[1], symbols: symbolsOf(m[2]), kind: "static" });
    for (const m of text.matchAll(IMPORT)) out.push({ spec: m[1], kind: "static" });
    return out;
  },

  resolve(from, spec, ctx, symbols) {
    const r = resolveModule(from, spec, ctx);
    if (r.kind === "internal" && symbols?.length && ctx.py?.barrels.has(r.ids[0])) {
      const retargets = symbols.map((s) => ctx.py.barrelMap.get(s)).filter(Boolean);
      if (retargets.length) return { kind: "internal", ids: retargets };
    }
    return r;
  },
};
