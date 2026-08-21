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

// `receiver.route/use(prefix, symbol)` — a literal prefix and a bare symbol —
// or `receiver.route/use(prefix, factory(args))`, the common "router built by a
// factory" shape (`app.use("/v1", createAuthRouter(deps))`). The symbol worth
// resolving in the second form is the factory's own name: it is what was
// imported, and its specifier lands on the same file a bare symbol would.
//
// A prefix that is not a literal is not a prefix we can use.
const MOUNT = /\b(\w+)\s*\.\s*(?:route|use)\s*\(\s*["']([^"']*)["']\s*,\s*(\w+)\s*(?:\([^()]*\))?\s*[,)]/g;


/** `/api/ai` + `/cleanup` -> `/api/ai/cleanup`, without doubling the slash. */
export const joinPath = (a, b) => (a + b).replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";

// One scan answers two questions, so it runs once per ctx and both callers read
// the same result. They used to be two near-identical passes in two modules,
// which is how they drifted: only one of them learned the factory form, so
// `resolveMounts` and the derived parent map disagreed about which files were
// mounted in the same repository.
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
    // A test harness routinely mounts a router at "/" to exercise it in
    // isolation. That is how the test reaches it, not how the application
    // serves it, and letting it in reports every route at two paths — one of
    // which nobody can call.
    if (ctx.config.layerOf?.(p).layer === "test") continue;
    // Blanked before matching, for the reason endpoints.mjs blanks: a mount
    // inside a comment or a template literal is not a mount, and a commented-out
    // `app.use("/v2", router)` would otherwise move every route behind it.
    const adapter = adapterFor(p);
    if (!adapter) continue;
    const text = adapter.blankComments(ctx.src.get(p) ?? "");
    if (!text) continue;

    const out = [];
    for (const m of text.matchAll(MOUNT)) {
      // `app.use("/*", handler)` is middleware over a wildcard, not a mount
      // point: nothing is served *at* `/*`.
      if (m[2].includes("*")) continue;
      // Symbol -> file is the load-bearing step, and it is done by asking the
      // adapter to resolve the specifier the symbol was imported from.
      // Guessing which file exports a name would be the fabrication this tool
      // refuses to make: a mount we cannot follow yields no prefix, and the
      // route it guards is reported at the path the file itself declares.
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

/**
 * Every file, mapped to the file(s) that mount it: `{child -> Set<parent>}`.
 * Path derivation seeds from this — it needs the parent/child relation itself,
 * where endpoint extraction needs the accumulated URL prefixes below.
 */
export function mountParents(ctx) {
  return scanMounts(ctx).parents;
}

/**
 * Every prefix each file is mounted under.
 *
 * A set per file, not one string: a router mounted twice genuinely serves its
 * routes at both paths, and collapsing that would report one of them as fiction.
 */
export function resolveMounts(ctx) {
  const { edges, mounted } = scanMounts(ctx);
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
