/**
 * The scan pipeline.
 *
 * acquire ref -> walk + filter -> per-file import extraction (adapter) ->
 * resolve -> classify -> endpoints -> tests -> nodes/edges/districts -> coverage ->
 * validate curated flows -> one JSON payload.
 *
 * The payload is a public contract: meta.schemaVersion versions it, and
 * meta.generatedAt is the only field allowed to differ between two runs of the
 * same input. Everything else is deterministic, which is what the golden files
 * depend on.
 */
import path from "node:path";
import { acquire } from "../scan/source.mjs";
import { collect } from "../scan/walk.mjs";
import { extractImports, buildNodes, buildEdges, buildDistricts } from "../model/graph.mjs";
import { extractEndpoints } from "../model/endpoints.mjs";
import { readSuites, subjectOf, FIXTURE } from "../model/tests.mjs";
import { deriveCoverage } from "../model/metrics.mjs";
import { derivePaths } from "../model/derive.mjs";
import { deriveFindings } from "../model/findings.mjs";
import { buildViews, buildTheme } from "../model/chrome.mjs";
import { embedSourceFiles } from "./embed.mjs";
import { loadConfig } from "../config/load.mjs";
import { detectServices } from "../config/detect.mjs";
import { reconcileServices } from "../model/classify.mjs";
import { ADAPTERS } from "../adapters/index.mjs";

export const SCHEMA_VERSION = 2;

/**
 * The flow index, inverted: which flows pass through each node.
 *
 * The flows already say which nodes they touch, so this costs one pass and no
 * new data — but reading it from the other end is what turns "here is a file"
 * into "here is what happens to this file". The viewer's TRAVELLED BY chips are
 * a control, not a label.
 *
 * Absent rather than empty on a node no flow touches: most nodes are, and an
 * empty array per node is pure payload weight.
 */
/**
 * Curated flow validation.
 *
 * Static imports cannot express request ordering, so flows are hand-authored.
 * That makes them the one part of the payload that can silently rot: a rename
 * leaves a step pointing at an id that no longer exists, and the map then draws
 * a chain that is not there. Every from/to is checked against the scanned node
 * set instead.
 *
 * Phase 2 demotes this to a warning with --strict restoring the hard fail,
 * because a stale curated flow must not be fatal for a general-purpose tool.
 * Phase 6 derives paths so that curation becomes an enhancement rather than a
 * requirement.
 */
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


/**
 * One playable path per endpoint, from what `derive.mjs` inferred.
 *
 * Steps arrive as integer node indices; flows are addressed by node id, so this
 * is the translation and nothing more. `certainty` rides along so the renderer
 * can draw an inferred hop differently from one an import justifies — the whole
 * point of deriving is undone if the two look the same.
 */
function derivedFlows(endpoints, nodes) {
  const out = [];
  for (const e of endpoints) {
    const steps = e.derivedPath?.steps ?? [];
    if (steps.length < 2) continue;
    out.push({
      id: `derived:${e.id}`,
      label: e.id,
      view: "derived",
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
  warn = () => {},
  progress = () => {},
}) {
  // Everything downstream reads one normalized shape, whether the values came
  // from a config file, from detection, or from the defaults.
  let config = loadConfig(userConfig);
  const source = acquire({ repo, ref, fetch, warn });
  try {
    const { all, paths, fileSet, src } = collect(source.dir, { keep: config.keep, exclude: config.exclude });
    progress("walk", `${paths.length} files`);

    // Detection needs the walk, and the walk needs keep/exclude, so the config
    // is loaded twice: once to filter, once with what the filtered tree revealed.
    // A declared service always wins — detection only fills a gap.
    if (!userConfig?.services) {
      const services = detectServices({ dir: source.dir, all, paths, exclude: config.exclude });
      if (services) config = loadConfig(userConfig, { detected: { services } });
    }

    // `dir` and `all` exist for adapters that need a file `keep` never admits
    // into `src` — `ts.mjs`'s tsconfig.json is the first one; every other
    // field downstream of this point still reads only `paths`/`fileSet`/`src`.
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
    // After path derivation, per CLAUDE.md's data flow: "endpoints no test
    // reaches" reads derivedPath, and everything else here reads the finished
    // graph and coverage rather than re-deriving anything.
    const findings = deriveFindings({ nodes, edges, endpoints, layers: config.layers }, config.findings);

    const bad = validateFlows(config, nodeIds);
    if (bad.length && strict) {
      throw new Error(`curated flow data references nodes that no longer exist:\n  ${bad.join("\n  ")}`);
    }
    for (const b of bad) warn(`warn: ${b}`);

    const codeNodes = nodes.filter((n) => n.kind === "file" && n.lang !== "md");

    // How much of this map the tool could not account for, in the payload
    // rather than only on stderr — the chrome states it permanently, because a
    // caveat in a panel nobody opens is not a caveat.
    //
    // A flow step counts as DERIVED unless a real import edge runs the same
    // direction: curation and derivation alike model an ordering that imports
    // cannot express, and the honesty contract does not distinguish them.
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
        // Was a hardcoded "4" in the viewer. Distinct suite kinds actually
        // observed, so a repo with one suite or none reads correctly.
        suiteCount: new Set(nodes.map((n) => n.testKind).filter(Boolean)).size,
        coverDirect: nodes.filter((n) => n.coverage === "direct").length,
        coverIndirect: nodes.filter((n) => n.coverage === "indirect").length,
        coverNone: nodes.filter((n) => n.coverage === "none").length,
        packageCount: new Set(nodes.flatMap((n) => n.externals)).size,
        unsortedCount: unclassified.length,
        unresolvedCount: stats.unresolved,
        derivedCount,
      },
      // Total by payload: whatever placed a node, its service is in this list.
      services: reconcileServices(config.services, nodes, warn),
      layers: config.layers,
      views: buildViews(config, config.flows ?? [], derived),
      theme: buildTheme(config),
      nodes,
      edges,
      endpoints,
      flows: config.flows ?? [],
      // Derived paths, as flows the viewer can play — but in their OWN array.
      // Curated data is somebody's assertion about their system; a derived path
      // is this tool's inference from imports. They render alike and they are
      // NOT alike, so the payload keeps them apart and the UI says which it is
      // showing. Merging them here would also silently rewrite the meaning of
      // every existing `flows` consumer.
      derivedFlows: derived,
      districts,
      findings,
      // Present only when `--embed-source` asked for it: a build without the
      // flag must serialize identically to one from before this field existed,
      // which is what keeps the golden files from moving under flags nobody
      // passed.
      ...(embedSource ? { source: embedSourceFiles({ paths, src, glob: embedGlob, gzip: gzipSource }) } : {}),
    };

    const orphanTests = nodes.filter((n) => n.layer === "test" && !n.subject && !FIXTURE.test(n.id));
    return { payload, diagnostics: { stats, unclassified, orphanTests } };
  } finally {
    source.cleanup();
  }
}
