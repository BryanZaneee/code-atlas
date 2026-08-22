/** Import extraction and graph construction; node/edge order is sorted so output stays byte-identical. */
import path from "node:path";
import { isVendorPath } from "../config/defaults.mjs";
import { adapterFor } from "../adapters/index.mjs";

/** Language by extension; anything unknown falls back to "src" (code we cannot name), never to prose. */
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
  // Unplaceable imports are collected, not warned per line; `atlas scan` prints them.
  const stats = { resolved: 0, unresolved: 0, external: 0, unresolvedSpecs: [] };
  const imports = new Map();

  let done = 0;
  for (const p of ctx.paths) {
    ctx.progress?.("parse", `${++done}/${ctx.paths.length}`);
    const internal = new Set();
    const external = new Set();
    // Import line by target id; adapters yield in source order, so first write wins.
    const lines = new Map();
    const adapter = adapterFor(p);

    for (const imp of adapter?.extractImports(ctx.src.get(p), p, ctx) ?? []) {
      const r = adapter.resolve(p, imp.spec, ctx, imp.symbols);
      if (r.kind === "internal") {
        // One specifier can name many files (barrel re-export); all share its line.
        for (const id of r.ids) {
          if (id === p) continue;
          internal.add(id);
          if (!lines.has(id)) lines.set(id, imp.line);
        }
        stats.resolved++;
      } else if (r.kind === "external") {
        external.add(r.ids[0]);
        stats.external++;
      } else {
        stats.unresolved++;
        stats.unresolvedSpecs.push({ from: p, spec: r.ids[0] });
      }
    }
    imports.set(p, { internal, external, lines });
  }
  return { imports, stats };
}

export function buildNodes(ctx, { imports, endpoints, testKind, subjectOf }) {
  const { layerOf, serviceOf, datastores = [] } = ctx.config;
  const nodes = [];
  const unclassified = [];

  for (const p of ctx.paths) {
    // Provenanced: the placing rule travels into the payload, so misclassification is a config edit.
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
      // Only present when true, so a build without --include-vendor serializes exactly as it did before the field existed.
      ...(isVendorPath(p) ? { vendor: true } : {}),
    });
  }

  for (const d of datastores) {
    nodes.push({
      id: d.id, name: d.label, dir: "infrastructure", service: "infra", layer: "datastore",
      lang: "-", loc: d.loc ?? 0, kind: "datastore", exports: 0, externals: [],
      testKind: null, subject: null, inDeg: 0, outDeg: 0, uncovered: false, note: d.note,
      // A datastore is config-declared, not rule-placed — that IS its provenance.
      layerWhy: "declared as a datastore in the config",
      serviceWhy: "datastores are grouped under the infra service",
    });
  }

  for (const e of endpoints) {
    nodes.push({
      id: e.id, name: e.id, dir: e.definedIn, service: e.service, layer: "endpoint",
      lang: "-", loc: 0, kind: "endpoint", exports: 0, externals: [],
      testKind: null, subject: null, inDeg: 0, outDeg: 0, uncovered: false,
      layerWhy: "an endpoint is its own layer, not a file's",
      serviceWhy: `the service of ${e.definedIn}`,
      why: e.why,
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
      // Only "import" edges carry a line: they alone come straight from an import statement.
      else push(n.id, t, "import", { line: imp.lines.get(t) });
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

  return { edges, nodeIds };
}

/** Two-character district code: service initial plus a free layer letter. See PLAN.md "The visual system". */
function codeFor(service, layer, taken) {
  const head = (service.match(/[a-z]/i)?.[0] ?? "x").toUpperCase();
  for (const c of (layer + "abcdefghijklmnopqrstuvwxyz0123456789").toUpperCase()) {
    if (!/[A-Z0-9]/.test(c)) continue;
    if (!taken.has(head + c)) return head + c;
  }
  // 36 colliding districts under one service letter: unreachable, but a code may not be undefined.
  return head + String(taken.size % 10);
}

export function buildDistricts(nodes, layers) {
  const districts = [];
  const byGid = new Map();
  for (const n of nodes) {
    const gid = `${n.service}/${n.layer}`;
    let g = byGid.get(gid);
    if (!g) {
      // parentId ships ahead of the nested layout that consumes it, so that rewrite is not a contract break.
      g = { id: gid, service: n.service, layer: n.layer, parentId: n.service, code: "", label: layers.find((l) => l.id === n.layer)?.label ?? n.layer, members: [] };
      byGid.set(gid, g);
      districts.push(g);
    }
    g.members.push(n.id);
  }

  // Assign in sorted id order, not appearance order, so adding a file cannot reshuffle codes.
  const taken = new Set();
  for (const g of [...districts].sort((a, b) => a.id.localeCompare(b.id))) {
    g.code = codeFor(g.service, g.layer, taken);
    taken.add(g.code);
  }
  return districts;
}

/** Map of from -> [to] over the edges `accept` admits. */
export function adjacency(edges, accept) {
  const adj = new Map();
  for (const e of edges) {
    if (!accept(e)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  return adj;
}

/** Every id reachable from `seeds` along `adj`, seeds included. */
export function reachableFrom(seeds, adj) {
  const reached = new Set(seeds);
  const queue = [...reached];
  while (queue.length) {
    for (const next of adj.get(queue.pop()) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}
