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

export function extractImports(ctx) {
  const stats = { resolved: 0, unresolved: 0, external: 0 };
  const imports = new Map();

  for (const p of ctx.paths) {
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
        ctx.warn(`  unresolved: ${p} -> ${r.ids[0]}`);
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
      lang: p.endsWith(".ts") ? "ts" : p.endsWith(".py") ? "py" : p.endsWith(".sql") ? "sql" : "md",
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

export function buildGroups(nodes, layers) {
  const groups = [];
  const byGid = new Map();
  for (const n of nodes) {
    const gid = `${n.service}/${n.layer}`;
    let g = byGid.get(gid);
    if (!g) {
      g = { id: gid, service: n.service, layer: n.layer, label: layers.find((l) => l.id === n.layer)?.label ?? n.layer, members: [] };
      byGid.set(gid, g);
      groups.push(g);
    }
    g.members.push(n.id);
  }
  return groups;
}
