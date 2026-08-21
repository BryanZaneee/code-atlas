/** Mount-chain resolution: a prefix assembled across files, so it runs to a fixpoint rather than in one pass. */
import { adapterFor } from "../adapters/index.mjs";

// `receiver.route/use(prefix, symbol)` or `(prefix, factory(args))`, with a literal prefix only.
const MOUNT = /\b(\w+)\s*\.\s*(?:route|use)\s*\(\s*["']([^"']*)["']\s*,\s*(\w+)\s*(?:\([^()]*\))?\s*[,)]/g;


/** `/api/ai` + `/cleanup` -> `/api/ai/cleanup`, without doubling the slash. */
export const joinPath = (a, b) => (a + b).replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";

// One scan per ctx for both callers, so the two answers cannot drift apart.
const SCAN = Symbol("mount scan");

/**
 * `{ edges, parents, mounted }` from a single pass.
 *
 *   edges    parent -> [{ child, prefix }]   (what the fixpoint walks)
 *   parents  child  -> Set<parent>           (who mounts this file)
 */
function scanMounts(ctx) {
  if (ctx[SCAN]) return ctx[SCAN];

  const edges = new Map();
  const parents = new Map();
  const mounted = new Set();

  for (const p of ctx.paths) {
    // A test harness mounting a router at "/" is not how the application serves it.
    if (ctx.config.layerOf?.(p).layer === "test") continue;
    // A mount inside a comment is not a mount, so match against blanked source.
    const adapter = adapterFor(p);
    if (!adapter) continue;
    const text = adapter.blankComments(ctx.src.get(p) ?? "");
    if (!text) continue;

    const out = [];
    for (const m of text.matchAll(MOUNT)) {
      // A wildcard is middleware, not a mount point: nothing is served at `/*`.
      if (m[2].includes("*")) continue;
      // Symbol -> file goes through the adapter; guessing which file exports a name would be fabrication.
      const spec = adapter.importBindings(text).find((b) => b.localNames.has(m[3]))?.spec ?? null;
      if (!spec) continue;
      const r = adapter.resolve(p, spec, ctx);
      const child = r.kind === "internal" ? r.ids[0] : null;
      if (!child || child === p) continue;
      out.push({ child, prefix: m[2] });
      mounted.add(child);
      if (!parents.has(child)) parents.set(child, new Set());
      parents.get(child).add(p);
    }
    if (out.length) edges.set(p, out);
  }

  ctx[SCAN] = { edges, parents, mounted };
  return ctx[SCAN];
}

/** Every file mapped to the file(s) that mount it: `{child -> Set<parent>}`. */
export function mountParents(ctx) {
  return scanMounts(ctx).parents;
}

/** Every prefix each file is mounted under: a set, because a router mounted twice serves both paths. */
export function resolveMounts(ctx) {
  const { edges, mounted } = scanMounts(ctx);
  if (!edges.size) return new Map();

  // A file nobody mounts is a root: nothing above it adds to the prefix it declares.
  const prefixes = new Map();
  for (const p of edges.keys()) if (!mounted.has(p)) prefixes.set(p, new Set([""]));

  // Fixpoint: the chain is as long as the repo makes it, and a cycle stops adding prefixes.
  for (let pass = 0; pass < 16; pass++) {
    let grew = false;
    for (const [parent, list] of edges) {
      // An unreached but mounted parent is not a root; it waits a pass rather than truncate its children's path.
      const bases = prefixes.get(parent);
      if (!bases) continue;
      for (const base of [...bases]) {
        for (const { child, prefix } of list) {
          const full = joinPath(base, prefix);
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
