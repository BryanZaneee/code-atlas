/** Path derivation: the internal path a request takes, modelled not observed. See PLAN.md "Path derivation + calibration". */
import { adapterFor } from "../adapters/index.mjs";
import { mountParents } from "./mounts.mjs";
import { adjacency } from "./graph.mjs";
import { OFF_SPINE_LAYERS } from "../config/defaults.mjs";

// The off-spine set is shared with the layering finding rather than restated, so the two cannot disagree.

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;


/** The source slice one handler owns: its declared line to the next route declaration, or EOF. */
function handlerSlice(text, line, otherLines) {
  const lines = text.split("\n");
  const next = otherLines.filter((l) => l > line).sort((a, b) => a - b)[0];
  const end = next ? next - 1 : lines.length;
  return lines.slice(line - 1, end).join("\n");
}

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

/** The mount-parent chain into `definedIn`, root-first and empty when nothing mounts it; ties break lexicographically so runs agree. */
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

  // Pre-admit the mount chain and definedIn, so a cycle back to one is a no-op rather than a duplicate.
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

  // Terminal: first admitted file with a datastore edge; the hop is always neutral "io", never read or write.
  let terminal = null;
  for (const n of nodesInOrder) {
    if (!admitted.has(n.id)) continue;
    const ds = dsAdj.get(n.id);
    if (ds?.length) { terminal = ds[0]; break; }
  }
  if (terminal && !admitted.has(terminal)) {
    admitted.set(terminal, Math.max(...admitted.values()) + 1);
  }

  // The mount chain and definedIn keep their proven sequence rather than being sorted by rank.
  const ordered = [...admitted.entries()]
    .filter(([id]) => !fixed.has(id))
    .map(([id, depth]) => ({ id, depth, rank: rankOf(id), inDeg: byId.get(id)?.inDeg ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.depth - b.depth || b.inDeg - a.inDeg || a.id.localeCompare(b.id))
    .map((n) => n.id);
  const path = [endpoint.id, ...mountChain, definedIn, ...ordered];

  // Mount-chain hops are proven by a literal registration, so they count as wired.
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

/** Attaches `.derivedPath = {steps}` to every endpoint, in place; an unrecognised shape skips a hop, never throws. */
export function derivePaths(ctx, { nodes, edges, endpoints }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const layerRank = new Map((ctx.config.layers ?? []).map((l) => [l.id, l.rank]));

  const importAdj = adjacency(edges, (e) => e.kind === "import");
  for (const list of importAdj.values()) list.sort();

  // Import edges only: a hop justified by a curated flow was asserted, not proven, and stays marked inferred.
  const edgeSet = new Set(edges.filter((e) => e.kind === "import").map((e) => `${e.from}|${e.to}`));

  // Datastore edges of any kind: this only asks whether a file is wired to a store at all.
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
