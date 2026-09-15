/** The scan pipeline: acquire ref -> walk -> extract -> resolve -> classify -> endpoints -> tests -> graph -> coverage -> one JSON payload, in which `meta.generatedAt` is the only field allowed to differ between two runs of one input. */
import path from "node:path";
import { acquire } from "../scan/source.mjs";
import { collect } from "../scan/walk.mjs";
import { extractImports, buildNodes, buildEdges, buildDistricts } from "../model/graph.mjs";
import { extractEndpoints } from "../model/endpoints.mjs";
import { readSuites, subjectOf, FIXTURE } from "../model/tests.mjs";
import { deriveCoverage } from "../model/metrics.mjs";
import { derivePaths } from "../model/derive.mjs";
import { deriveFindings } from "../model/findings.mjs";
import { buildViews, buildTheme, paintLayers } from "../model/chrome.mjs";
import { embedSourceFiles } from "./embed.mjs";
import { loadConfig } from "../config/load.mjs";
import { detectServices } from "../config/detect.mjs";
import { reconcileServices } from "../model/classify.mjs";
import { ADAPTERS } from "../adapters/index.mjs";

export const SCHEMA_VERSION = 2;

/** Curated flows are hand-authored, so they are the one part of the payload that can silently rot: a rename leaves a step pointing at a node that no longer exists, and the map draws a chain that is not there. */
export function validateFlows({ flows = [], extraEdges = [] }, nodeIds) {
  const bad = [];
  for (const f of flows) {
    for (const [i, s] of f.steps.entries()) {
      if (!nodeIds.has(s.from)) bad.push(`flow "${f.id}" step ${i}: unknown from "${s.from}"`);
      if (!nodeIds.has(s.to)) bad.push(`flow "${f.id}" step ${i}: unknown to "${s.to}"`);
    }
  }
  for (const e of extraEdges) {
    if (!nodeIds.has(e.from)) bad.push(`extra edge: unknown from "${e.from}"`);
    if (!nodeIds.has(e.to)) bad.push(`extra edge: unknown to "${e.to}"`);
  }
  return bad;
}

/** The flow index, inverted: which flows pass through each node. Absent rather than empty on a node no flow touches, since most nodes are. */
function indexFlows(nodes, flows) {
  const by = new Map();
  for (const f of flows) {
    for (const s of f.steps) {
      for (const id of [s.from, s.to]) {
        if (!by.has(id)) by.set(id, new Set());
        by.get(id).add(f.id);
      }
    }
  }
  for (const n of nodes) {
    const ids = by.get(n.id);
    if (ids) n.travelledBy = [...ids].sort();
  }
}


/** One playable path per endpoint, translating `derive.mjs`'s node indices to ids. `certainty` rides along so an inferred hop can be drawn differently from one an import justifies. */
function derivedFlows(endpoints, nodes) {
  const out = [];
  for (const e of endpoints) {
    const steps = e.derivedPath?.steps ?? [];
    if (steps.length < 2) continue;
    out.push({
      id: `derived:${e.id}`,
      label: e.id,
      // No `view`: derived paths lost their own strip button when the composer
      // started opening on every endpoint's path. They are reached by picking
      // the endpoint, and `derived: true` is what still marks them inferred.
      derived: true,
      blurb: "Inferred from imports — not observed. Dotted hops are gaps the import graph could not justify.",
      steps: steps.map((s) => ({
        from: nodes[s.from]?.id,
        to: nodes[s.to]?.id,
        kind: s.kind,
        certainty: s.certainty,
        inferred: s.inferred,
      })).filter((s) => s.from && s.to),
    });
  }
  return out;
}

export function scan({
  repo,
  ref,
  config: userConfig,
  fetch = true,
  strict = false,
  embedSource = false,
  embedGlob = null,
  gzipSource = false,
  includeVendor = false,
  warn = () => {},
  progress = () => {},
}) {
  // Everything downstream reads one normalized shape, whether the values came from a file, from detection, or from the defaults.
  // `includeVendor` rides in as an override so it outranks a config that named its own excludes — it is a flag the person at the terminal just typed.
  const flags = includeVendor ? { includeVendor: true } : {};
  let config = loadConfig(userConfig, { overrides: flags });
  const source = acquire({ repo, ref, fetch, warn });
  try {
    const { all, paths, fileSet, src } = collect(source.dir, { keep: config.keep, exclude: config.exclude });
    progress("walk", `${paths.length} files`);

    // Detection needs the walk and the walk needs keep/exclude, so the config loads twice; a declared service always wins.
    if (!userConfig?.services) {
      const services = detectServices({ dir: source.dir, all, paths, exclude: config.exclude });
      if (services) config = loadConfig(userConfig, { detected: { services }, overrides: flags });
    }

    // `dir` and `all` exist for adapters needing a file `keep` never admits into `src`, such as tsconfig.json; everything downstream reads only `paths`/`fileSet`/`src`.
    const ctx = { config, paths, fileSet, src, dir: source.dir, all, warn, progress };
    for (const a of ADAPTERS) if (a.prepare) ctx[a.id] = a.prepare(ctx);

    const { imports, stats } = extractImports(ctx);
    progress("resolve");
    const endpoints = extractEndpoints(ctx);
    progress("endpoints", `${endpoints.length}`);

    const suites = readSuites(ctx);
    const testKind = (p) => config.testKind(p, suites);

    const { nodes, unclassified } = buildNodes(ctx, {
      imports,
      endpoints,
      testKind,
      subjectOf: (p, internal) => subjectOf(p, internal, ctx),
    });
    const { edges, nodeIds } = buildEdges(nodes, {
      imports,
      endpoints,
      flows: config.flows,
      extraEdges: config.extraEdges,
    });
    progress("derive");
    deriveCoverage(nodes, edges);
    derivePaths(ctx, { nodes, edges, endpoints });
    indexFlows(nodes, config.flows ?? []);
    const districts = buildDistricts(nodes, config.layers);
    // After path derivation: findings read the finished graph, coverage and derivedPath rather than re-deriving anything.
    const findings = deriveFindings({ nodes, edges, endpoints, layers: config.layers }, config.findings);

    const bad = validateFlows(config, nodeIds);
    if (bad.length && strict) {
      throw new Error(`curated flow data references nodes that no longer exist:\n  ${bad.join("\n  ")}`);
    }
    for (const b of bad) warn(`warn: ${b}`);

    const codeNodes = nodes.filter((n) => n.kind === "file" && n.lang !== "md");

    // A flow step counts as derived unless a real import edge runs the same direction: curation and derivation both model an ordering imports cannot express.
    const observed = new Set(edges.filter((e) => e.kind === "import").map((e) => `${e.from}|${e.to}`));
    const derivedCount = (config.flows ?? []).reduce(
      (a, f) => a + f.steps.filter((s) => !observed.has(`${s.from}|${s.to}`)).length,
      0,
    );

    const derived = derivedFlows(endpoints, nodes);

    const payload = {
      meta: {
        schemaVersion: SCHEMA_VERSION,
        repo: path.basename(repo),
        ref,
        commit: source.commit.slice(0, 7),
        acquisition: source.acquisition,
        generatedAt: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
        nodeCount: nodes.length,
        fileCount: codeNodes.length,
        lineCount: codeNodes.reduce((a, n) => a + n.loc, 0),
        edgeCount: edges.length,
        docCount: nodes.filter((n) => n.lang === "md").length,
        endpointCount: endpoints.length,
        testCount: nodes.filter((n) => n.layer === "test").length,
        // Distinct suite kinds actually observed, so a repo with one suite or none reads correctly.
        suiteCount: new Set(nodes.map((n) => n.testKind).filter(Boolean)).size,
        coverDirect: nodes.filter((n) => n.coverage === "direct").length,
        coverIndirect: nodes.filter((n) => n.coverage === "indirect").length,
        coverNone: nodes.filter((n) => n.coverage === "none").length,
        packageCount: new Set(nodes.flatMap((n) => n.externals)).size,
        vendorCount: nodes.filter((n) => n.vendor).length,
        unsortedCount: unclassified.length,
        unresolvedCount: stats.unresolved,
        derivedCount,
      },
      // Total by payload: whatever placed a node, its service is in this list.
      services: reconcileServices(config.services, nodes, warn),
      // Painted from the ramp here rather than in the viewer, so the colour a reader sees is in the payload and in the golden.
      layers: paintLayers(config.layers),
      views: buildViews(config, config.flows ?? [], derived, endpoints),
      theme: buildTheme(config, config.layers.length),
      nodes,
      edges,
      endpoints,
      flows: config.flows ?? [],
      // In their own array: a curated flow is somebody's assertion, a derived path is this tool's inference, and merging them would also rewrite what `flows` means to every existing consumer.
      derivedFlows: derived,
      districts,
      findings,
      // Present only when `--embed-source` asked for it, so a build without the flag serializes identically to one from before the field existed.
      ...(embedSource ? { source: embedSourceFiles({ paths, src, glob: embedGlob, gzip: gzipSource }) } : {}),
    };

    const orphanTests = nodes.filter((n) => n.layer === "test" && !n.subject && !FIXTURE.test(n.id));
    return { payload, diagnostics: { stats, unclassified, orphanTests } };
  } finally {
    source.cleanup();
  }
}
