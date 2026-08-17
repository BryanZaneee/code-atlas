/**
 * The scan pipeline.
 *
 * acquire ref -> walk + filter -> per-file import extraction (adapter) ->
 * resolve -> classify -> endpoints -> tests -> nodes/edges/groups -> coverage ->
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
import { extractImports, buildNodes, buildEdges, buildGroups } from "../scan/graph.mjs";
import { extractEndpoints } from "../model/endpoints.mjs";
import { readSuites, subjectOf, FIXTURE } from "../model/tests.mjs";
import { deriveCoverage } from "../model/metrics.mjs";
import { validateFlows } from "../model/flows.mjs";
import { buildViews } from "../model/views.mjs";
import { buildTheme } from "../model/theme.mjs";
import { loadConfig } from "../config/load.mjs";
import { detectServices } from "../config/detect.mjs";
import { reconcileServices } from "../model/classify.mjs";
import { ADAPTERS } from "../adapters/index.mjs";

export const SCHEMA_VERSION = 1;

export function scan({ repo, ref, config: userConfig, fetch = true, strict = true, warn = () => {} }) {
  // Everything downstream reads one normalized shape, whether the values came
  // from a config file, from detection, or from the defaults.
  let config = loadConfig(userConfig);
  const source = acquire({ repo, ref, fetch, warn });
  try {
    const { all, paths, fileSet, src } = collect(source.dir, { keep: config.keep, exclude: config.exclude });

    // Detection needs the walk, and the walk needs keep/exclude, so the config
    // is loaded twice: once to filter, once with what the filtered tree revealed.
    // A declared service always wins — detection only fills a gap.
    if (!userConfig?.services) {
      const services = detectServices({ dir: source.dir, all, paths, exclude: config.exclude });
      if (services) config = loadConfig(userConfig, { detected: { services } });
    }

    const ctx = { config, paths, fileSet, src, warn };
    for (const a of ADAPTERS) if (a.prepare) ctx[a.id] = a.prepare(ctx);

    const { imports, stats } = extractImports(ctx);
    const endpoints = extractEndpoints(ctx);

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
    deriveCoverage(nodes, edges);
    const groups = buildGroups(nodes, config.layers);

    const bad = validateFlows(config, nodeIds);
    if (bad.length && strict) {
      throw new Error(`curated flow data references nodes that no longer exist:\n  ${bad.join("\n  ")}`);
    }
    for (const b of bad) warn(`warn: ${b}`);

    const codeNodes = nodes.filter((n) => n.kind === "file" && n.lang !== "md");
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
      },
      // Total by payload: whatever placed a node, its service is in this list.
      services: reconcileServices(config.services, nodes, warn),
      layers: config.layers,
      views: buildViews(config, config.flows ?? []),
      theme: buildTheme(config),
      nodes,
      edges,
      endpoints,
      flows: config.flows ?? [],
      groups,
    };

    const orphanTests = nodes.filter((n) => n.layer === "test" && !n.subject && !FIXTURE.test(n.id));
    return { payload, diagnostics: { stats, unclassified, orphanTests, suites } };
  } finally {
    source.cleanup();
  }
}

/** The stderr summary. Everything logs to stderr so --json stdout stays clean. */
export function report(payload, diagnostics, warn) {
  const { stats, unclassified, orphanTests } = diagnostics;
  const m = payload.meta;
  warn(`atlas: ref ${m.ref} @ ${m.commit}`);
  warn(`atlas: ${m.fileCount} code files, ${m.lineCount} lines, ${m.edgeCount} edges, ${m.endpointCount} endpoints`);
  warn(`atlas: imports resolved=${stats.resolved} unresolved=${stats.unresolved} external=${stats.external}`);
  // The unsorted share is the honest read on classification quality: a repo
  // whose layout no rule recognises still renders, and this is how you find out
  // that is what happened rather than wondering why it is one column.
  const share = m.fileCount ? Math.round((unclassified.length / m.fileCount) * 100) : 0;
  const sample = unclassified.slice(0, 6).join(", ") + (unclassified.length > 6 ? `, +${unclassified.length - 6} more` : "");
  warn(`atlas: unsorted files=${unclassified.length} (${share}% — placed by fallback)${unclassified.length ? " -> " + sample : ""}`);
  warn(`atlas: tests without a subject=${orphanTests.length}${orphanTests.length ? " -> " + orphanTests.map((n) => n.name).join(", ") : ""}`);
}
