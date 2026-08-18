/**
 * Import extraction and graph construction.
 *
 * This is the seam CLAUDE.md calls load-bearing: everything language-specific
 * happens inside an adapter, and everything from "the edge list exists" onward
 * is language-agnostic and lives here or in src/model/.
 *
 * Ordering is load-bearing too. Nodes follow the sorted path order and edges
 * follow node order, which is what makes two runs of the same input produce
 * byte-identical output — and therefore what makes a golden diff meaningful.
 */
import path from "node:path";
import { adapterFor } from "../adapters/index.mjs";

/**
 * The language a file is written in, from its extension.
 *
 * This used to be a three-way test with markdown as the else branch, which was
 * true only while the kept set was `.ts .py .sql .md`. Widen the keep pattern and
 * every unrecognised extension silently becomes prose: a Rust or JSX file gets
 * counted as documentation and drops out of `fileCount` and `lineCount`
 * entirely. Anything unknown is code we cannot name, not prose.
 */
const LANGS = [
  [/\.tsx?$/, "ts"], [/\.[cm]?jsx?$/, "js"], [/\.py$/, "py"], [/\.go$/, "go"],
  [/\.rs$/, "rs"], [/\.rb$/, "rb"], [/\.java$/, "java"], [/\.kt$/, "kt"],
  [/\.php$/, "php"], [/\.sql$/, "sql"], [/\.(json|ya?ml|toml)$/, "json"],
  [/\.(md|mdx|rst|txt)$/, "md"],
];

export function langOf(p) {
  return LANGS.find(([re]) => re.test(p))?.[1] ?? "src";
}

export function extractImports(ctx) {
  // `unresolvedSpecs` is collected rather than warned about one line at a time:
  // an import the tool could not place is a diagnostic, and a repository whose
  // adapter is missing produces thousands of them. `atlas scan` prints them.
  const stats = { resolved: 0, unresolved: 0, external: 0, unresolvedSpecs: [] };
  const imports = new Map();

  let done = 0;
  for (const p of ctx.paths) {
    ctx.progress?.("parse", `${++done}/${ctx.paths.length}`);
    const internal = new Set();
    const external = new Set();
    const adapter = adapterFor(p);

    for (const imp of adapter?.extractImports(ctx.src.get(p), p, ctx) ?? []) {
      const r = adapter.resolve(p, imp.spec, ctx, imp.symbols);
      if (r.kind === "internal") {
        // ids is an array so one specifier can name many files — a barrel
        // re-export is the case that shows up here first.
        for (const id of r.ids) if (id !== p) internal.add(id);
        stats.resolved++;
      } else if (r.kind === "external") {
        external.add(r.ids[0]);
        stats.external++;
      } else {
        stats.unresolved++;
        stats.unresolvedSpecs.push({ from: p, spec: r.ids[0] });
      }
    }
    imports.set(p, { internal, external });
  }
  return { imports, stats };
}

export function buildNodes(ctx, { imports, endpoints, testKind, subjectOf }) {
  const { layerOf, serviceOf, datastores = [] } = ctx.config;
  const nodes = [];
  const unclassified = [];

  for (const p of ctx.paths) {
    // Provenanced: the rule that placed this file travels with it into the
    // payload, so a misclassification is a config edit rather than a bug report.
    const placed = layerOf(p);
    const svc = serviceOf(p);
    if (!placed.matched) unclassified.push(p);
    const layer = placed.layer;
    const text = ctx.src.get(p);
    const loc = text.length ? text.replace(/\n$/, "").split("\n").length : 0;
    const isTest = layer === "test";
    const { internal, external } = imports.get(p) ?? { internal: new Set(), external: new Set() };
    nodes.push({
      id: p,
      name: p.split("/").pop(),
      dir: path.posix.dirname(p),
      service: svc.service,
      serviceWhy: svc.why,
      layer,
      layerWhy: placed.why,
      lang: langOf(p),
      loc,
      kind: "file",
      exports: (text.match(/^export /gm) ?? []).length + (text.match(/^(def|class) /gm) ?? []).length,
      externals: [...external].sort(),
      testKind: isTest ? testKind(p) : null,
      subject: isTest ? subjectOf(p, internal) : null,
      inDeg: 0,
      outDeg: 0,
      coverage: null,
      uncovered: false,
    });
  }

  for (const d of datastores) {
    nodes.push({
      id: d.id, name: d.label, dir: "infrastructure", service: "infra", layer: "datastore",
      lang: "-", loc: d.loc ?? 0, kind: "datastore", exports: 0, externals: [],
      testKind: null, subject: null, inDeg: 0, outDeg: 0, uncovered: false, note: d.note,
    });
  }

  for (const e of endpoints) {
    nodes.push({
      id: e.id, name: e.id, dir: e.definedIn, service: e.service, layer: "endpoint",
      lang: "-", loc: 0, kind: "endpoint", exports: 0, externals: [],
      testKind: null, subject: null, inDeg: 0, outDeg: 0, uncovered: false,
    });
  }

  return { nodes, unclassified };
}

export function buildEdges(nodes, { imports, endpoints, flows = [], extraEdges = [] }) {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  const seen = new Set();

  const push = (from, to, kind, extra = {}) => {
    const key = `${from}|${to}|${kind}`;
    if (seen.has(key) || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;
    seen.add(key);
    const a = byId.get(from), b = byId.get(to);
    edges.push({
      from,
      to,
      kind,
      cross: a.service !== b.service && a.service !== "infra" && b.service !== "infra",
      ...extra,
    });
  };

  for (const n of nodes) {
    if (n.kind !== "file") continue;
    const imp = imports.get(n.id);
    if (!imp) continue;
    for (const t of imp.internal) {
      if (n.layer === "test") push(n.id, t, t === n.subject ? "test:subject" : "test:exercises");
      else push(n.id, t, "import");
    }
    if (n.subject) push(n.id, n.subject, "test:subject");
  }

  for (const e of endpoints) push(e.id, e.definedIn, "http");
  for (const e of extraEdges) push(e.from, e.to, e.kind, { note: e.note });
  for (const f of flows) {
    for (const s of f.steps) push(s.from, s.to, s.kind === "error" ? "http" : s.kind, { flow: f.id });
  }

  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (a) a.outDeg++;
    if (b) b.inDeg++;
  }

  return { edges, nodeIds, byId };
}

/**
 * A short, stable name for a district: first letter of the service, then the
 * first letter of the layer that is still free.
 *
 * Two characters is the whole point — it is legible at any zoom and it never
 * collides with a neighbour's label, so nothing ever has to be dropped. It is
 * assigned per district and not per file deliberately: a repo draws hundreds of
 * file blocks, and hundreds of two-character codes are not a mapping anyone
 * learns. See PLAN.md, "The visual system".
 *
 * Preferring letters that actually occur in the layer name keeps the code
 * readable (`api/service` -> `AS`) before it falls back to brute force, and the
 * caller assigns in sorted id order so adding a file cannot reshuffle the rest.
 */
function codeFor(service, layer, taken) {
  const head = (service.match(/[a-z]/i)?.[0] ?? "x").toUpperCase();
  for (const c of (layer + "abcdefghijklmnopqrstuvwxyz0123456789").toUpperCase()) {
    if (!/[A-Z0-9]/.test(c)) continue;
    if (!taken.has(head + c)) return head + c;
  }
  // 36 districts under one service letter, all colliding. Unreachable in
  // practice, but a code is not allowed to be undefined.
  return head + String(taken.size % 10);
}

export function buildGroups(nodes, layers) {
  const groups = [];
  const byGid = new Map();
  for (const n of nodes) {
    const gid = `${n.service}/${n.layer}`;
    let g = byGid.get(gid);
    if (!g) {
      // parentId is the district-hierarchy field PLAN.md ships ahead of the
      // nested layout that consumes it: adding it now means that rewrite does
      // not also break the payload contract.
      g = { id: gid, service: n.service, layer: n.layer, parentId: n.service, code: "", label: layers.find((l) => l.id === n.layer)?.label ?? n.layer, members: [] };
      byGid.set(gid, g);
      groups.push(g);
    }
    g.members.push(n.id);
  }

  // Codes are assigned in sorted id order while the array keeps its own order:
  // first-appearance order is deterministic for one input but moves when a file
  // is added, and a code that moves is worse than no code at all.
  const taken = new Set();
  for (const g of [...groups].sort((a, b) => a.id.localeCompare(b.id))) {
    g.code = codeFor(g.service, g.layer, taken);
    taken.add(g.code);
  }
  return groups;
}
