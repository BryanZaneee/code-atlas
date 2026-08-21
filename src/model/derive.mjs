/**
 * Path derivation: the internal path a request takes, MODELLED not observed.
 * Under-claiming is always the safer failure here. Algorithm, certainty
 * vocabulary and the seed rule: PLAN.md "Path derivation + calibration".
 */
import { adapterFor } from "../adapters/index.mjs";
import { mountParents } from "./mounts.mjs";
import { adjacency } from "./graph.mjs";
import { OFF_SPINE_LAYERS } from "../config/defaults.mjs";

// The router -> controller -> service -> repository spine is what this exists
// to trace; a request never legitimately routes through a test file or a
// README. The set is shared with the layering finding rather than restated,
// because two modules quietly disagreeing about what counts as the spine is
// how one of them ends up wrong. A layer with no known rank (a custom
// classifier's own catch-all) is excluded the same way, below.

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;


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
/** Internal files reached by imports whose bound name is used in `slice`. */
function seedTargets(file, slice, ctx) {
  const adapter = adapterFor(file);
  const targets = new Set();
  if (!adapter) return targets;
  const sliceIdents = new Set(slice.match(IDENT_RE) ?? []);
  if (!sliceIdents.size) return targets;
  for (const b of adapter.importBindings(ctx.src.get(file) ?? "")) {
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

  const importAdj = adjacency(edges, (e) => e.kind === "import");
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
  const dsAdj = adjacency(edges, (e) => byId.get(e.to)?.kind === "datastore");
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
