/**
 * Findings — what the tool says about the code it just mapped, rather than
 * about its own read of it (`atlas scan` is that one). Every finding here is
 * structural: it reads the graph `src/model/graph.mjs` already built and the
 * coverage/derivation `src/model/metrics.mjs` and `src/model/derive.mjs`
 * already computed. Nothing here re-parses source or adds a second heuristic
 * pass — see CLAUDE.md, "Regex, not AST": findings are arithmetic over data
 * the rest of the pipeline already produced.
 *
 * Total by construction (CLAUDE.md, "Graceful degradation"): no config, no
 * tests, no entrypoints, zero edges, a one-file repo — every function below
 * degrades to an empty array rather than guessing or crashing. A finding type
 * whose basis is not measured for this repository (no entry layer, no test
 * coverage at all) reports nothing rather than a false positive; see the
 * per-function notes.
 *
 * Ordering is explicit everywhere: never a Map/Set's insertion order derived
 * from anything but the already-sorted `nodes`/`edges` arrays, and every
 * finding list is sorted before it is returned. That is what keeps
 * `atlas findings --json` byte-identical across two runs of the same input.
 *
 * Each finding is `{ id, type, severity, message, why, evidence }`.
 * `id` is deterministic and is the string a config's `findings.mute` names to
 * silence it. `severity` is `"info" | "warning" | "error"`. `evidence` is
 * `{ nodes: string[], edges: {from,to,kind}[] }` — the exact ids a renderer
 * highlights, never a prose description.
 */
import { OFF_SPINE_LAYERS, UNREACHED_LAYERS } from "../config/defaults.mjs";
import { adjacency, reachableFrom } from "./graph.mjs";


/** p-th percentile of an ascending-sorted array, nearest-rank method. */
function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

const sample = (ids, n = 6) => ids.slice(0, n).join(", ") + (ids.length > n ? `, +${ids.length - n} more` : "");

/**
 * Import cycles — Tarjan's SCC over `kind: "import"` edges between file nodes,
 * reported smallest-first. Iterative, not recursive: an unbounded call stack
 * over an adversarial or simply large repo is the kind of resource exhaustion
 * CLAUDE.md's security posture rules out.
 *
 * Self-edges never reach here — `buildEdges`'s `push` refuses `from === to` —
 * so every SCC of size 1 is a single file with no self-cycle, not a finding.
 */
function findCycles(nodes, edges) {
  const adj = adjacency(edges, (e) => e.kind === "import");

  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;

  for (const start of nodes) {
    if (start.kind !== "file" || index.has(start.id)) continue;
    // Explicit work stack: [nodeId, next-neighbour-index] per frame, standing
    // in for the call stack a recursive Tarjan would use.
    const work = [[start.id, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, ci] = frame;
      if (ci === 0) {
        index.set(v, counter);
        lowlink.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const neighbours = adj.get(v) ?? [];
      if (ci < neighbours.length) {
        frame[1]++;
        const w = neighbours[ci];
        if (!index.has(w)) {
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(v)));
        }
        if (lowlink.get(v) === index.get(v)) {
          const scc = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            scc.push(w);
          } while (w !== v);
          if (scc.length > 1) sccs.push(scc.sort());
        }
      }
    }
  }

  return sccs
    .sort((a, b) => a.length - b.length || a.join(",").localeCompare(b.join(",")))
    .map((members) => {
      const memberSet = new Set(members);
      const cycleEdges = edges
        .filter((e) => e.kind === "import" && memberSet.has(e.from) && memberSet.has(e.to))
        .map((e) => ({ from: e.from, to: e.to, kind: e.kind }));
      return {
        id: `cycle:${members.join(",")}`,
        type: "cycle",
        severity: members.length >= 4 ? "error" : "warning",
        message: `${members.length} files form an import cycle: ${sample(members)}`,
        why: "None of these files can be understood, changed or tested in isolation from the rest of the cycle.",
        evidence: { nodes: members, edges: cycleEdges },
      };
    });
}

/**
 * Layering violations — an edge whose TARGET sits at a LOWER rank than its
 * SOURCE.
 *
 * Rank ascends along the natural request spine (route -> service ->
 * repository, PLAN.md "The visual system"), so an ordinary import moves to an
 * equal or higher rank. An edge that moves to a LOWER rank runs the spine
 * backwards — a repository importing a controller is the textbook case — and
 * that, not the reverse, is the violation. Equal rank (two files in the same
 * layer) is normal and not flagged.
 *
 * ONLY spine layers are compared. `tooling`, `test`, `docs` and `unsorted`
 * carry ranks so the layout has somewhere to put them, but those ranks are
 * positions in a column order, not positions on the spine. `unsorted` is the
 * one that does real damage: it ranks above every real layer, so judging it
 * turns "no rule matched this file" into "every import this file makes runs
 * backwards" — an entrypoint script importing its own config gets reported as
 * an error, and the finding that matters drowns in the ones that do not. An
 * absence of knowledge is not a high rank. Same set derive.mjs walks the spine
 * with, imported rather than restated.
 */
function findLayeringViolations(edges, byId, layerRank) {
  const out = [];
  for (const e of edges) {
    if (e.kind !== "import") continue;
    const fromLayer = byId.get(e.from)?.layer;
    const toLayer = byId.get(e.to)?.layer;
    if (OFF_SPINE_LAYERS.has(fromLayer) || OFF_SPINE_LAYERS.has(toLayer)) continue;
    const fromRank = layerRank.get(fromLayer);
    const toRank = layerRank.get(toLayer);
    if (fromRank == null || toRank == null) continue;
    if (toRank < fromRank) {
      const distance = fromRank - toRank;
      out.push({
        id: `layering:${e.from}>${e.to}`,
        type: "layering",
        severity: distance >= 3 ? "error" : "warning",
        message: `${e.from} (${byId.get(e.from).layer}) imports ${e.to} (${byId.get(e.to).layer}), against the declared layer order`,
        why: "An import running backward through the layers is what makes a change in one place ripple everywhere instead of downward only.",
        evidence: { nodes: [e.from, e.to], edges: [{ from: e.from, to: e.to, kind: "import" }] },
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Oversized files — LOC past `threshold`, ranked relative to the repository's
 * own p95, not to a fixed number: a 2000-line file is unremarkable in a repo
 * whose p95 is 1800 and glaring in one whose p95 is 80.
 */
function findOversizedFiles(nodes, threshold) {
  const files = nodes.filter((n) => n.kind === "file");
  const p95 = percentile(files.map((n) => n.loc).sort((a, b) => a - b), 95);
  return files
    .filter((n) => n.loc > threshold)
    .sort((a, b) => b.loc - a.loc || a.id.localeCompare(b.id))
    .map((n) => {
      const multiple = p95 > 0 ? n.loc / p95 : Infinity;
      return {
        id: `oversized-file:${n.id}`,
        type: "oversized-file",
        severity: multiple >= 2 ? "error" : multiple >= 1.25 ? "warning" : "info",
        message: `${n.id} is ${n.loc} lines (repo p95 is ${p95})`,
        why: "A file well past the repository's own p95 is the one most likely doing several jobs at once.",
        evidence: { nodes: [n.id], edges: [] },
      };
    });
}

/**
 * Endpoints no test reaches — `endpoint -> derived path ∩ test-reachable set
 * = ∅`. The test-reachable set is every node `deriveCoverage` marked
 * `direct` or `indirect`; the path is the endpoint's own derived path plus
 * the file that declares it, so an endpoint with no derived path (a gap
 * derivation could not bridge) still checks against the one node that
 * certainly matters.
 *
 * A repository with no measured coverage at all (`deriveCoverage` found no
 * test import edges — no tests, or an adapter that cannot resolve them)
 * reports nothing here: "not measured" is not "untested", and claiming the
 * latter on evidence the tool does not have is exactly what the honesty
 * contract in CLAUDE.md rules out.
 */
function findUntestedEndpoints(nodes, endpoints) {
  const reachable = new Set(nodes.filter((n) => n.coverage === "direct" || n.coverage === "indirect").map((n) => n.id));
  if (!reachable.size) return [];

  const out = [];
  for (const e of endpoints) {
    const steps = e.derivedPath?.steps ?? [];
    const pathIds = new Set([e.definedIn]);
    for (const s of steps) {
      const from = nodes[s.from]?.id;
      const to = nodes[s.to]?.id;
      if (from) pathIds.add(from);
      if (to) pathIds.add(to);
    }
    if ([...pathIds].some((id) => reachable.has(id))) continue;
    out.push({
      id: `untested-endpoint:${e.id}`,
      type: "untested-endpoint",
      severity: "warning",
      message: `${e.id} — no test reaches its handler or its derived path`,
      why: "A route with no test on its path fails silently: nothing breaks CI when the handler itself breaks.",
      evidence: { nodes: [...new Set([e.id, ...pathIds])].sort(), edges: [{ from: e.id, to: e.definedIn, kind: "http" }] },
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Orphans — zero in-edges and zero out-edges, excluding entrypoints (a
 * legitimate zero-in-edge, zero-out-edge node by definition) and any path a
 * config names under `findings.orphanRoots` — a build script or a standalone
 * tool a repository keeps on purpose.
 */
function findOrphans(nodes, roots) {
  const isRoot = (id) => roots.some((r) => id === r || id.startsWith(r.replace(/\/$/, "") + "/"));
  return nodes
    .filter((n) => n.kind === "file" && n.layer !== "entry" && n.inDeg === 0 && n.outDeg === 0 && !isRoot(n.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({
      id: `orphan:${n.id}`,
      type: "orphan",
      severity: "info",
      message: `${n.id} has no incoming or outgoing edges`,
      why: "Nothing imports it and it imports nothing — either dead code, or wiring this tool cannot see (config, DI, a script run by name).",
      evidence: { nodes: [n.id], edges: [] },
    }));
}

/**
 * Unreachable from any entrypoint — forward BFS along `kind: "import"` edges
 * starting from every `layer: "entry"` file, mirroring the same
 * direct-then-reached shape `deriveCoverage` uses for test coverage.
 *
 * A repository with no entry-layer node at all (no rule recognised one)
 * reports nothing: there is no entrypoint to measure reachability from, so
 * "unreachable" would be a claim about every file rather than about the ones
 * that actually sit off the spine. Test, docs, tooling and migration files
 * are excluded via UNREACHED_LAYERS — they were never meant to be reached by
 * a request in the first place. Orphans, oversized files and god nodes do
 * NOT apply this exclusion — PLAN.md states each of those three in terms of
 * plain in/out-degree or LOC with no layer carve-out, and a repository's own
 * config/docs/tooling files legitimately having zero edges is itself part of
 * what "orphan" means there.
 */
function findUnreachable(nodes, edges) {
  const entryIds = nodes.filter((n) => n.kind === "file" && n.layer === "entry").map((n) => n.id);
  if (!entryIds.length) return [];

  const reached = reachableFrom(entryIds, adjacency(edges, (e) => e.kind === "import"));

  return nodes
    .filter((n) => n.kind === "file" && !UNREACHED_LAYERS.has(n.layer) && !reached.has(n.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({
      id: `unreachable:${n.id}`,
      type: "unreachable",
      severity: "warning",
      message: `${n.id} is not reachable from any entrypoint by import`,
      why: "Nothing on the traced request spine ever leads here — it runs only if something outside the import graph invokes it.",
      evidence: { nodes: [n.id], edges: [] },
    }));
}

/**
 * God nodes — in-degree past a percentile threshold, with `minInDegree` as a
 * floor so a small repo, where the 95th percentile can be a single import,
 * does not flag half its files.
 */
function findGodNodes(nodes, percentileCfg, minInDegree) {
  const files = nodes.filter((n) => n.kind === "file");
  const threshold = Math.max(percentile(files.map((n) => n.inDeg).sort((a, b) => a - b), percentileCfg), minInDegree);
  return files
    .filter((n) => n.inDeg >= threshold && n.inDeg > 0)
    .sort((a, b) => b.inDeg - a.inDeg || a.id.localeCompare(b.id))
    .map((n) => ({
      id: `god-node:${n.id}`,
      type: "god-node",
      severity: n.inDeg >= threshold * 2 ? "error" : "warning",
      message: `${n.id} is imported by ${n.inDeg} files (threshold ${threshold})`,
      why: "Everything that depends on this file pays for every change to it — a good place to look before touching it.",
      evidence: { nodes: [n.id], edges: [] },
    }));
}

/**
 * Cross-service coupling — direct import edges that already carry `cross`
 * (`buildEdges`: different declared services, neither one `infra`). This
 * reuses that field rather than recomputing it, because it is the same
 * question `edges[].cross` already answers: does this edge bypass the
 * service boundary the config declared.
 */
function findCrossServiceCoupling(edges, byId) {
  return edges
    .filter((e) => e.kind === "import" && e.cross)
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .map((e) => ({
      id: `cross-service:${e.from}>${e.to}`,
      type: "cross-service",
      severity: "warning",
      message: `${e.from} (${byId.get(e.from)?.service}) imports ${e.to} (${byId.get(e.to)?.service}) directly, across the service boundary`,
      why: "A direct file import between services is a hidden coupling a network boundary would otherwise force into the open.",
      evidence: { nodes: [e.from, e.to], edges: [{ from: e.from, to: e.to, kind: "import" }] },
    }));
}

/**
 * The eight findings, in PLAN.md's own order, each already sorted. Muting
 * (`findings.mute: [{id, reason}]`) never removes a finding from the payload —
 * it stamps `muted`/`muteReason` on it, so `atlas findings --json` stays a
 * complete account of what was found and a config change to mute one is a
 * visible, reviewable diff rather than a silent subtraction.
 */
export function deriveFindings({ nodes, edges, endpoints, layers }, cfg = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layerRank = new Map((layers ?? []).map((l) => [l.id, l.rank]));

  const raw = [
    ...findCycles(nodes, edges),
    ...findLayeringViolations(edges, byId, layerRank),
    ...findOversizedFiles(nodes, cfg.locThreshold ?? 400),
    ...findUntestedEndpoints(nodes, endpoints ?? []),
    ...findOrphans(nodes, cfg.orphanRoots ?? []),
    ...findUnreachable(nodes, edges),
    ...findGodNodes(nodes, cfg.godNodePercentile ?? 95, cfg.minGodInDegree ?? 5),
    ...findCrossServiceCoupling(edges, byId),
  ];

  const muteReasons = new Map((cfg.mute ?? []).map((m) => [m.id, m.reason]));
  return raw.map((f) => {
    const reason = muteReasons.get(f.id);
    return reason != null ? { ...f, muted: true, muteReason: reason } : { ...f, muted: false, muteReason: null };
  });
}
