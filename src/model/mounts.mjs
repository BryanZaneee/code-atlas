/**
 * Mount-chain resolution.
 *
 * A router registers `"/cleanup"` and is mounted into another router at `"/"`,
 * which is mounted into the app at `"/api/ai"`. The real path is `/api/ai/cleanup`
 * and no single file contains it — the prefix has to be carried across files,
 * which is why this runs to a fixpoint rather than in one pass.
 *
 * Symbol -> file is the load-bearing step, and it is done by asking the adapter
 * that owns the file to resolve the specifier the symbol was imported from.
 * Guessing which file exports a name would be exactly the fabrication this tool
 * refuses to make: a mount we cannot follow yields no prefix, and the route it
 * guards is reported at the path the file itself declares rather than at an
 * invented one.
 */
import { adapterFor } from "../adapters/index.mjs";

// `app.route("/api/ai", aiRouter)` / `app.use("/v1", router)` — a literal prefix
// and a bare symbol. A prefix that is not a literal is not a prefix we can use.
const MOUNT = /\b(\w+)\s*\.\s*(?:route|use)\s*\(\s*["']([^"']*)["']\s*,\s*(\w+)\s*[,)]/g;

/** The specifier a symbol was imported from, in this file. */
function specifierFor(text, symbol) {
  const named = new RegExp(
    `\\bimport\\s*(?:type\\s*)?\\{([^}]*\\b${symbol}\\b[^}]*)\\}\\s*from\\s*["']([^"']+)["']`,
  );
  const asDefault = new RegExp(`\\bimport\\s+${symbol}\\s*(?:,|from)[^"']*["']([^"']+)["']`);
  const m = text.match(named);
  if (m) return m[2];
  return text.match(asDefault)?.[1] ?? null;
}

/** The file a symbol imported into `from` actually lives in, or null. */
function fileForSymbol(from, symbol, ctx) {
  const spec = specifierFor(ctx.src.get(from) ?? "", symbol);
  if (!spec) return null;
  const adapter = adapterFor(from);
  if (!adapter) return null;
  const r = adapter.resolve(from, spec, ctx);
  return r.kind === "internal" ? r.ids[0] : null;
}

const join = (a, b) => (a + b).replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";

/**
 * Every prefix each file is mounted under.
 *
 * A set per file, not one string: a router mounted twice genuinely serves its
 * routes at both paths, and collapsing that would report one of them as fiction.
 */
export function resolveMounts(ctx) {
  // file -> [{ child, prefix }]
  const edges = new Map();
  const mounted = new Set();
  for (const p of ctx.paths) {
    // A test harness routinely mounts a router at "/" to exercise it in
    // isolation. That is how the test reaches it, not how the application
    // serves it, and letting it in reports every route at two paths — one of
    // which nobody can call.
    if (ctx.config.layerOf?.(p).layer === "test") continue;
    const text = ctx.src.get(p);
    if (!text) continue;
    const out = [];
    for (const m of text.matchAll(MOUNT)) {
      // `app.use("/*", handler)` is middleware over a wildcard, not a mount
      // point: nothing is served *at* `/*`.
      if (m[2].includes("*")) continue;
      const child = fileForSymbol(p, m[3], ctx);
      if (!child || child === p) continue;
      out.push({ child, prefix: m[2] });
      mounted.add(child);
    }
    if (out.length) edges.set(p, out);
  }
  if (!edges.size) return new Map();

  // A file nobody mounts is a root: its own routes sit at the prefix it
  // declares and nothing above it adds to that.
  const prefixes = new Map();
  for (const p of edges.keys()) if (!mounted.has(p)) prefixes.set(p, new Set([""]));

  // Fixpoint: a chain is only as long as the repo makes it, and a router
  // mounted into a cycle stops adding prefixes once nothing new appears.
  for (let pass = 0; pass < 16; pass++) {
    let grew = false;
    for (const [parent, list] of edges) {
      // A parent that is itself mounted but has not been reached yet is not a
      // root — treating it as one publishes its children at a truncated path
      // that survives even after the real prefix arrives. It waits a pass.
      const bases = prefixes.get(parent);
      if (!bases) continue;
      for (const base of [...bases]) {
        for (const { child, prefix } of list) {
          const full = join(base, prefix);
          if (!prefixes.has(child)) prefixes.set(child, new Set());
          if (prefixes.get(child).has(full)) continue;
          prefixes.get(child).add(full);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return prefixes;
}
