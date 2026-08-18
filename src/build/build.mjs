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
import { derivePaths } from "../model/derive.mjs";
import { validateFlows } from "../model/flows.mjs";
import { buildViews } from "../model/views.mjs";
import { buildTheme } from "../model/theme.mjs";
import { loadConfig } from "../config/load.mjs";
import { detectServices } from "../config/detect.mjs";
import { reconcileServices } from "../model/classify.mjs";
import { ADAPTERS } from "../adapters/index.mjs";

export const SCHEMA_VERSION = 1;

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
    const groups = buildGroups(nodes, config.layers);

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
      groups,
    };

    const orphanTests = nodes.filter((n) => n.layer === "test" && !n.subject && !FIXTURE.test(n.id));
    return { payload, diagnostics: { stats, unclassified, orphanTests, suites } };
  } finally {
    source.cleanup();
  }
}

/** `a, b, c, +N more` — a sample long enough to recognise, short enough to read. */
function sample(items, n) {
  return items.slice(0, n).join(", ") + (items.length > n ? `, +${items.length - n} more` : "");
}

/** The stderr summary. Everything logs to stderr so --json stdout stays clean. */
export function report(payload, diagnostics, warn) {
  const { stats, unclassified, orphanTests } = diagnostics;
  const m = payload.meta;
  // Which rung ran decides whether this picture is reproducible from a commit,
  // so it leads the report rather than hiding in the payload.
  const a = m.acquisition;
  const at = a.commit ? `@ ${a.commit}` : "uncommitted";
  warn(`atlas: ${a.mode} ${a.ref ?? ""} ${at}${a.dirty ? " · DIRTY" : ""}`);
  warn(`atlas: ${m.fileCount} code files, ${m.lineCount} lines, ${m.edgeCount} edges, ${m.endpointCount} endpoints`);
  warn(`atlas: imports resolved=${stats.resolved} unresolved=${stats.unresolved} external=${stats.external}`);
  // The unsorted share is the honest read on classification quality: a repo
  // whose layout no rule recognises still renders, and this is how you find out
  // that is what happened rather than wondering why it is one column.
  const share = m.fileCount ? Math.round((unclassified.length / m.fileCount) * 100) : 0;
  warn(`atlas: unsorted files=${unclassified.length} (${share}% — placed by fallback)${unclassified.length ? " -> " + sample(unclassified, 6) : ""}`);
  warn(`atlas: tests without a subject=${orphanTests.length}${orphanTests.length ? " -> " + orphanTests.map((n) => n.name).join(", ") : ""}`);
}

/**
 * `atlas scan` — the long form of the same report.
 *
 * This diagnoses the *tool's read* of a repository, not the repository:
 * which specifiers it could not place, and how its files fell across the
 * columns and rows it drew. `atlas findings` (phase 5) is the one that
 * diagnoses the code.
 *
 * The histograms are the fastest way to see a config is wrong: every file in
 * one layer means no rule matched anything, and every file in one service means
 * detection found no manifest.
 */
export function diagnose(payload, diagnostics, out) {
  const { stats } = diagnostics;
  report(payload, diagnostics, out);

  if (stats.unresolvedSpecs.length) {
    // Grouped by specifier: one missing alias accounts for a hundred of these,
    // and a list of a hundred identical lines hides that fact rather than showing it.
    const by = new Map();
    for (const u of stats.unresolvedSpecs) by.set(u.spec, (by.get(u.spec) ?? 0) + 1);
    const ranked = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out(`atlas: unresolved specifiers, most common first`);
    for (const [spec, n] of ranked.slice(0, 20)) out(`  ${String(n).padStart(4)} × ${spec}`);
    if (ranked.length > 20) out(`  +${ranked.length - 20} more`);
  }

  // Endpoint registrations the extractor saw but could not turn into an
  // endpoint without guessing — a non-literal path, or a literal path handed
  // to a helper whose method this tool does not follow. Grouped by file the
  // same way unresolved specifiers are grouped by spec: one helper accounts
  // for most of these, and a flat list of a dozen identical lines hides that.
  const skips = payload.endpoints.skips ?? [];
  if (skips.length) {
    const by = new Map();
    for (const s of skips) by.set(s.file, (by.get(s.file) ?? 0) + 1);
    const ranked = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out(`atlas: endpoint registrations skipped (non-literal path or invisible method)=${skips.length}`);
    for (const [file, n] of ranked.slice(0, 20)) out(`  ${String(n).padStart(4)} × ${file}`);
    if (ranked.length > 20) out(`  +${ranked.length - 20} more`);
  }

  // "No endpoints here" and "this tool cannot read this language" are the same
  // empty result from the outside, and only one of them is a fact about the
  // repository. Reported by language rather than per file: one missing adapter
  // is otherwise a hundred identical lines that hide the cause.
  const unscanned = payload.endpoints.unscanned ?? [];
  if (unscanned.length) {
    const total = unscanned.reduce((a, [, n]) => a + n, 0);
    out(`atlas: files no endpoint rule could be run over (no adapter for the language)=${total}`);
    for (const [lang, n] of unscanned) out(`  ${String(n).padStart(4)} ${lang}`);
  }

  for (const [title, key, order] of [
    ["layers", "layer", payload.layers.map((l) => l.id)],
    ["services", "service", payload.services.map((s) => s.id)],
  ]) {
    const counts = new Map(order.map((id) => [id, 0]));
    for (const n of payload.nodes) counts.set(n[key], (counts.get(n[key]) ?? 0) + 1);
    const used = [...counts].filter(([, n]) => n > 0);
    out(`atlas: ${title} in use=${used.length}/${counts.size}`);
    for (const [id, n] of used) out(`  ${String(n).padStart(4)} ${id}`);
  }
}
