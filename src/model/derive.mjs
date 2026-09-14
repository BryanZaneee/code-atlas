/**
 * Path derivation — the internal path a request takes, MODELLED rather than
 * observed. Most repositories curate zero flows, so this is what makes
 * curation an enhancement instead of a requirement (PLAN.md "Path derivation +
 * calibration"). It is also the most honesty-critical code in the project: a
 * derived hop is never rendered as fact, and under-claiming (fewer hops) is
 * always the safer failure than a plausible-looking invented one.
 *
 * Algorithm, per PLAN.md, run once per endpoint:
 *
 *   0. Seed with the mount chain (statically PROVEN wiring) — certainty:"wired".
 *      The endpoint -> definedIn edge already IS one link of that proof: it is
 *      the exact call site extractEndpoints found. The rest of the chain —
 *      whichever file(s) actually call `app.route/use(prefix, definedIn)`,
 *      walked back to a root the same way src/model/mounts.mjs's fixpoint
 *      does — is proof of the same kind and is walked here too: without it, a
 *      two-file Express/FastAPI app (app.ts registers, routes.ts declares) is
 *      missing its first hop on every single endpoint.
 *   1. BFS from endpoint.definedIn over internal import edges: depth <= 6,
 *      rank non-decreasing, layer not skipped, not already admitted.
 *   2. Sort by (rank, depth, inDegree desc, path); one step per adjacent pair.
 *      Real edge -> solid, certainty:"imported". Gap -> dotted, inferred:true.
 *   3. Terminals: a file with a datastore edge terminates into it with the
 *      NEUTRAL kind "io" — static analysis cannot tell a read from a write.
 *   4. Response leg: reverse, <=3 hops, all inferred.
 *
 * The highest-value refinement is step 1's seed: a route file typically
 * imports far more than the one endpoint being derived needs, so the BFS's
 * first hop is restricted to imports whose bound identifier is actually used
 * in THIS endpoint's own source — the slice from its declared line to the next
 * route declaration in the same file (or EOF). Everything past that first hop
 * walks the plain import graph, because downstream files are not route
 * handlers and have no such boundary to slice against.
 *
 * Steps are stored as integer indices into the `nodes` array — the payload
 * already carries that array, so a path string would only be a second name for
 * data that exists once. `endpoint.derivedPath.steps[]` is `{from, to, kind,
 * certainty, inferred}`; certainty is `wired` | `imported` | `inferred`.
 */
import { adapterFor } from "../adapters/index.mjs";
import { mountParents } from "./mounts.mjs";
import { OFF_SPINE_LAYERS } from "../config/defaults.mjs";

// The router -> controller -> service -> repository spine is what this exists
// to trace; a request never legitimately routes through a test file or a
// README. The set is shared with the layering finding rather than restated,
// because two modules quietly disagreeing about what counts as the spine is
// how one of them ends up wrong. A layer with no known rank (a custom
// classifier's own catch-all) is excluded the same way, below.

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Blank `//`, `#` and `/* *\/` comments so a symbol name in a comment cannot seed a hop. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/(^|[ \t])#.*$/gm, "$1");
}

/**
 * The source slice this one endpoint's handler owns: from its declared line to
 * the next route declaration in the same file, or EOF. A route file routinely
 * imports fifteen things for fifteen endpoints; only some are on this one's path.
 */
function handlerSlice(text, line, otherLines) {
  const lines = text.split("\n");
  const next = otherLines.filter((l) => l > line).sort((a, b) => a - b)[0];
  const end = next ? next - 1 : lines.length;
  return lines.slice(line - 1, end).join("\n");
}

/**
 * This file's own import statements, as `{spec, localNames, symbols}` — the
 * identifiers a statement actually binds locally, not merely the module it
 * names. `symbols` (Python only) is the pre-alias name the adapter's barrel
 * retargeting needs; `localNames` is what handler-slice matching checks
 * against, and for an aliased import those two differ.
 *
 * Regex, not AST, same as every adapter — this is a second, narrower pass over
 * the same statements for information the adapters themselves do not track
 * (ts.mjs never needed bound names; py.mjs tracks pre-alias names only, for its
 * own barrel resolution).
 */
function importBindings(text, langId) {
  const clean = stripComments(text);
  const out = [];
  if (langId === "ts") {
    const NAMED = /\bimport\s+(?:type\s+)?(?:(\w+)\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
    for (const m of clean.matchAll(NAMED)) {
      const localNames = new Set(m[1] ? [m[1]] : []);
      for (const part of m[2].split(",")) {
        const s = part.trim().replace(/^type\s+/, "");
        if (!s) continue;
        const bits = s.split(/\s+as\s+/);
        localNames.add((bits[1] ?? bits[0]).trim());
      }
      out.push({ spec: m[3], localNames });
    }
    const NAMESPACE = /\bimport\s+\*\s+as\s+(\w+)\s*from\s*["']([^"']+)["']/g;
    for (const m of clean.matchAll(NAMESPACE)) out.push({ spec: m[2], localNames: new Set([m[1]]) });
    const DEFAULT_ONLY = /\bimport\s+(\w+)\s*from\s*["']([^"']+)["']/g;
    for (const m of clean.matchAll(DEFAULT_ONLY)) out.push({ spec: m[2], localNames: new Set([m[1]]) });
    const REQ = /\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
    for (const m of clean.matchAll(REQ)) out.push({ spec: m[2], localNames: new Set([m[1]]) });
    const REQ_DESTRUCT = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
    for (const m of clean.matchAll(REQ_DESTRUCT)) {
      const localNames = new Set();
      for (const part of m[1].split(",")) {
        const s = part.trim();
        if (!s) continue;
        const bits = s.split(":").map((x) => x.trim());
        localNames.add(bits[1] ?? bits[0]);
      }
      out.push({ spec: m[2], localNames });
    }
  } else if (langId === "py") {
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
  }
  return out;
}

/** Internal files reached by imports whose bound name is used in `slice`. */
function seedTargets(file, slice, ctx) {
  const adapter = adapterFor(file);
  const targets = new Set();
  if (!adapter) return targets;
  const sliceIdents = new Set(slice.match(IDENT_RE) ?? []);
  if (!sliceIdents.size) return targets;
  for (const b of importBindings(ctx.src.get(file) ?? "", adapter.id)) {
    if (![...b.localNames].some((n) => sliceIdents.has(n))) continue;
    const r = adapter.resolve(file, b.spec, ctx, b.symbols);
    if (r.kind === "internal") for (const id of r.ids) targets.add(id);
  }
  return targets;
}

/**
 * The mount-parent chain leading into `definedIn`, root-first: `[app.ts]` for
 * a one-level mount, `[]` when nothing mounts it (unmounted or unresolvable —
 * never guessed at). One parent per hop, lexicographically first on a genuine
 * tie, so two runs of one input agree; capped short of `mounts.mjs`'s 16-pass
 * fixpoint because this walks one linear chain, not the whole graph.
 */
function mountChainFor(definedIn, mountParents) {
  const chain = [];
  const seen = new Set([definedIn]);
  let cur = definedIn;
  for (let i = 0; i < 6; i++) {
    const ps = [...(mountParents.get(cur) ?? [])].sort();
    const parent = ps.find((p) => !seen.has(p));
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parent);
    cur = parent;
  }
  return chain;
}

/** One endpoint's derived path, as `{from, to, kind, certainty, inferred}[]` of node indices. */
function deriveOne(endpoint, { byId, idIdx, importAdj, layerRank, edgeSet, dsAdj, nodesInOrder, endpointsByFile, mountParents }, ctx) {
  const definedIn = endpoint.definedIn;
  if (!idIdx.has(definedIn) || !idIdx.has(endpoint.id)) return { steps: [] };

  const rankOf = (id) => layerRank.get(byId.get(id)?.layer) ?? Infinity;
  const startRank = rankOf(definedIn);

  const mountChain = mountChainFor(definedIn, mountParents);

  const otherLines = (endpointsByFile.get(definedIn) ?? []).map((e) => e.line);
  const slice = handlerSlice(ctx.src.get(definedIn) ?? "", endpoint.line, otherLines);

  // The mount chain and definedIn are pre-admitted (not re-discovered, not
  // re-ordered by the sort below) so a cycle back to one of them through the
  // import graph is a no-op rather than a duplicate, and so a mount-chain file
  // with its own datastore edge is still found by the terminal search.
  const fixed = new Set([...mountChain, definedIn]);
  const admitted = new Map([...mountChain, definedIn].map((id) => [id, 0])); // id -> BFS depth
  const queue = [];
  for (const t of [...seedTargets(definedIn, slice, ctx)].sort()) {
    if (admitted.has(t)) continue;
    const layer = byId.get(t)?.layer;
    if (!layer || OFF_SPINE_LAYERS.has(layer) || rankOf(t) < startRank) continue;
    admitted.set(t, 1);
    queue.push(t);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const depth = admitted.get(cur);
    if (depth >= 6) continue;
    const curRank = rankOf(cur);
    for (const to of importAdj.get(cur) ?? []) {
      if (admitted.has(to)) continue;
      const layer = byId.get(to)?.layer;
      if (!layer || OFF_SPINE_LAYERS.has(layer) || rankOf(to) < curRank) continue;
      admitted.set(to, depth + 1);
      queue.push(to);
    }
  }

  // Terminal: the first admitted file (in stable node order) with an edge into
  // a datastore node. We cannot tell a read from a write statically, so the
  // hop that lands there is never anything but the neutral "io".
  let terminal = null;
  for (const n of nodesInOrder) {
    if (!admitted.has(n.id)) continue;
    const ds = dsAdj.get(n.id);
    if (ds?.length) { terminal = ds[0]; break; }
  }
  if (terminal && !admitted.has(terminal)) {
    admitted.set(terminal, Math.max(...admitted.values()) + 1);
  }

  // The mount chain and definedIn are placed by proven sequence, not sorted
  // with the rest — they are not a set to reorder by rank.
  const ordered = [...admitted.entries()]
    .filter(([id]) => !fixed.has(id))
    .map(([id, depth]) => ({ id, depth, rank: rankOf(id), inDeg: byId.get(id)?.inDeg ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.depth - b.depth || b.inDeg - a.inDeg || a.id.localeCompare(b.id))
    .map((n) => n.id);
  const path = [endpoint.id, ...mountChain, definedIn, ...ordered];

  // Every hop through the mount chain into definedIn is proven the same way
  // the endpoint -> definedIn edge is: a literal registration this tool
  // followed, not an import it is guessing matters.
  const wiredHops = mountChain.length + 1;

  const requestSteps = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const real = edgeSet.has(`${a}|${b}`);
    const certainty = i < wiredHops ? "wired" : real ? "imported" : "inferred";
    requestSteps.push({
      from: idIdx.get(a),
      to: idIdx.get(b),
      kind: b === terminal ? "io" : "request",
      certainty,
      inferred: certainty === "inferred",
    });
  }

  const respHops = Math.min(3, requestSteps.length);
  const responseSteps = [];
  for (let i = 0; i < respHops; i++) {
    const a = path[path.length - 1 - i], b = path[path.length - 2 - i];
    responseSteps.push({ from: idIdx.get(a), to: idIdx.get(b), kind: "response", certainty: "inferred", inferred: true });
  }

  return { steps: [...requestSteps, ...responseSteps] };
}

/**
 * Derives and attaches `.derivedPath = {steps}` to every endpoint, in place.
 * Never throws on a shape it does not recognise — a skipped hop is the
 * failure mode here, never a crash (PLAN.md "graceful degradation").
 */
export function derivePaths(ctx, { nodes, edges, endpoints }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const layerRank = new Map((ctx.config.layers ?? []).map((l) => [l.id, l.rank]));

  const importAdj = new Map();
  for (const e of edges) {
    if (e.kind !== "import") continue;
    if (!importAdj.has(e.from)) importAdj.set(e.from, []);
    importAdj.get(e.from).push(e.to);
  }
  for (const list of importAdj.values()) list.sort();

  // ONLY import edges. `edges` also carries curated flow and extraEdge
  // relationships, and a hop justified by one of those is not "imported" — a
  // person asserted it, an import did not prove it. Counting them here would
  // relabel modelled wiring as observed, which is the one thing the honesty
  // contract forbids. They stay in the path; they are just marked inferred.
  const edgeSet = new Set(edges.filter((e) => e.kind === "import").map((e) => `${e.from}|${e.to}`));

  // A file's edges into a datastore node — any kind (sql/cache/s3/...), since
  // this is deliberately not read/write: static analysis cannot tell them
  // apart, and step 3 needs only "is this file wired to a store at all".
  const dsAdj = new Map();
  for (const e of edges) {
    if (byId.get(e.to)?.kind !== "datastore") continue;
    if (!dsAdj.has(e.from)) dsAdj.set(e.from, []);
    dsAdj.get(e.from).push(e.to);
  }
  for (const list of dsAdj.values()) list.sort();

  const endpointsByFile = new Map();
  for (const e of endpoints) {
    if (!endpointsByFile.has(e.definedIn)) endpointsByFile.set(e.definedIn, []);
    endpointsByFile.get(e.definedIn).push(e);
  }

  const parents = mountParents(ctx);

  const shared = { byId, idIdx, importAdj, layerRank, edgeSet, dsAdj, nodesInOrder: nodes, endpointsByFile, mountParents: parents };
  for (const endpoint of endpoints) {
    endpoint.derivedPath = deriveOne(endpoint, shared, ctx);
  }
}
