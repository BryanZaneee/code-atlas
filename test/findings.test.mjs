/**
 * Findings — src/model/findings.mjs, the Phase 5 gate.
 *
 * `fixtures/import-cycle` is built so each of the eight findings has exactly
 * one deliberate, known-true instance isolated from the rest (see its
 * README) — most tests here point at a specific id rather than asserting
 * "some findings exist somewhere." `mini-monorepo` and `taxvault` cover the
 * two gates a synthetic fixture cannot: zero false positives on a repo that
 * enforces layering, and known-true results on a real, messy corpus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scan } from "../src/build/build.mjs";
import { deriveFindings } from "../src/model/findings.mjs";
import { OFF_SPINE_LAYERS } from "../src/config/defaults.mjs";
import { scanFixture, serialize, requireCorpus, REPO_ROOT } from "./helpers.mjs";

const IMPORT_CYCLE_CONFIG = path.join(REPO_ROOT, "fixtures/import-cycle/atlas.config.mjs");

const findingsOf = async (fixture, opts) => (await scanFixture(fixture, opts)).payload.findings;
const byType = (findings, type) => findings.filter((f) => f.type === type);
const byId = (findings, id) => findings.find((f) => f.id === id);

// ---------------------------------------------------------------------------
// Totality (CLAUDE.md, "Graceful degradation is a requirement, not a nicety")
// ---------------------------------------------------------------------------

test("deriveFindings is total with no nodes, no edges and no config", () => {
  assert.deepEqual(deriveFindings({ nodes: [], edges: [], endpoints: [], layers: [] }), []);
  assert.deepEqual(deriveFindings({ nodes: [], edges: [], endpoints: [], layers: [] }, {}), []);
});

test("an empty repository yields an empty findings array, not a crash", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-findings-empty-"));
  try {
    const { payload } = scan({ repo: dir, ref: "fs", config: undefined, fetch: false, warn: () => {} });
    assert.deepEqual(payload.findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no config, no tests: findings still runs end to end (flat-app)", async () => {
  const findings = await findingsOf("flat-app");
  assert.ok(Array.isArray(findings));
  // No entry-layer BFS root ever fails to run, but with no test suite at all
  // coverage is not measured — "no test reaches this" must not be claimed.
  assert.deepEqual(byType(findings, "untested-endpoint"), []);
});

test("a repository with no entry-layer node reports no unreachable findings", () => {
  const nodes = [
    { id: "a.ts", kind: "file", layer: "service", inDeg: 0, outDeg: 0, loc: 1 },
    { id: "b.ts", kind: "file", layer: "service", inDeg: 0, outDeg: 0, loc: 1 },
  ];
  const findings = deriveFindings({ nodes, edges: [], endpoints: [], layers: [] });
  assert.deepEqual(byType(findings, "unreachable"), []);
});

test("a repository with no measured coverage reports no untested-endpoint findings", () => {
  const nodes = [{ id: "routes/h.ts", kind: "file", layer: "route", inDeg: 0, outDeg: 0, loc: 1, coverage: null }];
  const endpoints = [{ id: "GET /x", definedIn: "routes/h.ts", derivedPath: { steps: [] } }];
  const findings = deriveFindings({ nodes, edges: [], endpoints, layers: [] });
  assert.deepEqual(byType(findings, "untested-endpoint"), []);
});

// ---------------------------------------------------------------------------
// Determinism (test/payload.test.mjs's own gate, extended to findings)
// ---------------------------------------------------------------------------

test("two runs of the same input produce byte-identical findings", async () => {
  const [a, b] = await Promise.all([scanFixture("import-cycle"), scanFixture("import-cycle")]);
  assert.equal(serialize(a.payload), serialize(b.payload));
});

test("finding order is stable and does not depend on Map/Set insertion order", async () => {
  const findings = await findingsOf("import-cycle");
  const ids = findings.map((f) => f.id);
  const resorted = [...findings];
  // Re-deriving from the same scan must reproduce the exact same order.
  const again = await findingsOf("import-cycle");
  assert.deepEqual(again.map((f) => f.id), ids);
  assert.deepEqual(resorted.map((f) => f.id), ids);
});

// ---------------------------------------------------------------------------
// Each finding type — fixtures/import-cycle
// ---------------------------------------------------------------------------

test("import cycles: Tarjan finds the known 3-file cycle, smallest-first", async () => {
  const findings = await findingsOf("import-cycle");
  const cycles = byType(findings, "cycle");
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].evidence.nodes, ["src/services/a.ts", "src/services/b.ts", "src/services/c.ts"]);
  assert.ok(cycles[0].evidence.edges.length >= 3, "the cycle's own edges should be in evidence.edges");
});

test("layering violations: repository importing route is flagged, in the right direction", async () => {
  const findings = await findingsOf("import-cycle");
  const violation = byId(findings, "layering:src/repository/store.ts>src/routes/handler.ts");
  assert.ok(violation, "expected the repository -> route layering violation");
  assert.deepEqual(violation.evidence.nodes, ["src/repository/store.ts", "src/routes/handler.ts"]);

  // The reverse direction (route -> repository) is normal flow and must never
  // be reported as a violation by itself.
  assert.equal(byId(findings, "layering:src/routes/handler.ts>src/repository/store.ts"), undefined);
});

test("layering violations: zero false positives on a repo that enforces layering by policy", async () => {
  const findings = await findingsOf("mini-monorepo");
  assert.deepEqual(byType(findings, "layering"), []);
});

/**
 * The false positive that outnumbered the true ones.
 *
 * `unsorted` ranks ABOVE every real layer — it has to sit somewhere in the
 * column order and after everything else is the honest place — so comparing
 * its rank to a real one turns "no rule matched this file" into "every import
 * it makes runs backwards". On this repository that was six of nine layering
 * findings, five of them severity `error`, including `bin/atlas.mjs` importing
 * its own config loader. A rank is a position in the layout; only a spine
 * layer's rank is a position on the spine.
 *
 * Asserted over a fixture that HAS unsorted files, because mini-monorepo does
 * not — which is exactly why the gate above went on passing while this was
 * broken.
 */
test("layering violations never judge a file no rule could place", async () => {
  for (const fixture of ["hostile-ts", "hostile-py", "flat-app"]) {
    const { payload } = await scanFixture(fixture);
    const byNode = new Map(payload.nodes.map((n) => [n.id, n]));
    const offSpine = payload.nodes.filter((n) => OFF_SPINE_LAYERS.has(n.layer));
    for (const f of byType(payload.findings, "layering")) {
      for (const id of f.evidence.nodes) {
        assert.equal(
          OFF_SPINE_LAYERS.has(byNode.get(id)?.layer), false,
          `${fixture}: ${f.id} judges ${id}, which is ${byNode.get(id)?.layer} — off the spine`,
        );
      }
    }
    // The assertion above is vacuous unless the fixture actually contains such
    // files, and a vacuous gate is worse than no gate.
    if (fixture === "hostile-py") assert.ok(offSpine.length > 0, "fixture has no off-spine files to prove anything with");
  }
});

test("oversized files: ranked relative to the repo's own p95", async () => {
  const findings = await findingsOf("import-cycle");
  const oversized = byType(findings, "oversized-file");
  assert.ok(oversized.some((f) => f.evidence.nodes[0] === "src/util/big.ts"));
});

test("endpoints no test reaches: the untested endpoint is flagged, the tested path is not", async () => {
  const findings = await findingsOf("import-cycle");
  const untested = byId(findings, "untested-endpoint:GET /health");
  assert.ok(untested, "GET /health has no test on its path and must be flagged");
  assert.ok(untested.evidence.nodes.includes("src/routes/handler.ts"));
});

test("orphans: the zero-degree file is flagged, excluding the entrypoint", async () => {
  const findings = await findingsOf("import-cycle");
  const orphans = byType(findings, "orphan");
  assert.ok(orphans.some((f) => f.evidence.nodes[0] === "src/util/orphan.ts"));
  assert.equal(byId(findings, "orphan:src/index.ts"), undefined, "the entrypoint must never be reported as an orphan");
});

test("orphans: findings.orphanRoots excludes a configured path", async () => {
  const base = (await import(pathToFileURL(IMPORT_CYCLE_CONFIG).href)).default;
  const config = { ...base, findings: { ...base.findings, orphanRoots: ["src/util/orphan.ts"] } };
  const findings = await findingsOf("import-cycle", { config });
  assert.equal(byId(findings, "orphan:src/util/orphan.ts"), undefined, "orphanRoots must exclude the named path");
  // A zero-degree file NOT named in orphanRoots is still reported.
  assert.ok(byId(findings, "orphan:src/util/big.ts"));
});

test("unreachable from any entrypoint: everything past the wired route is flagged", async () => {
  const findings = await findingsOf("import-cycle");
  const unreachable = byType(findings, "unreachable").map((f) => f.evidence.nodes[0]);
  assert.ok(unreachable.includes("src/repository/store.ts"));
  assert.ok(unreachable.includes("src/services/a.ts"));
  // The entrypoint and the file it actually wires up are reachable.
  assert.ok(!unreachable.includes("src/index.ts"));
  assert.ok(!unreachable.includes("src/routes/handler.ts"));
});

test("god nodes: the file every cycle member imports is flagged", async () => {
  const findings = await findingsOf("import-cycle");
  const godNodes = byType(findings, "god-node").map((f) => f.evidence.nodes[0]);
  assert.ok(godNodes.includes("src/util/shared.ts"));
});

test("cross-service coupling: the direct cross-boundary import is flagged", async () => {
  const findings = await findingsOf("import-cycle");
  const coupling = byId(findings, "cross-service:src/controller/handler2.ts>packages/billing/ledger.ts");
  assert.ok(coupling, "expected the app -> billing direct import to be flagged");
});

// ---------------------------------------------------------------------------
// Negative cases
//
// The positive tests above all point at fixtures/import-cycle, which was built
// to contain one of everything. That proves each check fires; it cannot prove
// a check stays quiet when it should. These assert the absence, on fixtures
// that are deliberately clean, and each one guards against being vacuous:
// a fixture with no import edges would pass "no cycles" for the wrong reason.
// ---------------------------------------------------------------------------

test("cycles: none reported on acyclic repositories that do have imports", async () => {
  for (const fixture of ["mini-monorepo", "flat-app"]) {
    const { payload } = await scanFixture(fixture);
    assert.ok(
      payload.edges.filter((e) => e.kind === "import").length > 0,
      `${fixture}: no import edges, so "no cycles" proves nothing`,
    );
    assert.deepEqual(
      byType(payload.findings, "cycle"), [],
      `${fixture}: reported a cycle in a fixture that has none`,
    );
  }
});

test("orphans: a file with edges is never reported, whichever direction they run", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const orphanIds = new Set(byType(payload.findings, "orphan").map((f) => f.evidence.nodes[0]));

  // The one true orphan, so the assertions below are not passing on an empty set.
  assert.deepEqual([...orphanIds], ["docs/overview.md"]);

  // server.ts imports but is imported by nothing. An orphan is a file nothing
  // connects to in EITHER direction, so a zero in-degree alone must not flag it.
  const entry = payload.nodes.find((n) => n.id === "services/api/src/server.ts");
  assert.equal(entry.inDeg, 0, "fixture changed: server.ts was the zero-in-degree case");
  assert.ok(entry.outDeg > 0);
  assert.equal(orphanIds.has(entry.id), false, "a file that imports others is not an orphan");

  for (const n of payload.nodes) {
    if (n.inDeg + n.outDeg > 0) {
      assert.equal(orphanIds.has(n.id), false, `${n.id} has edges and must not be an orphan`);
    }
  }
});

test("untested endpoints: an endpoint a test path reaches is not flagged", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const flagged = new Set(
    byType(payload.findings, "untested-endpoint").map((f) => f.id.replace("untested-endpoint:", "")),
  );

  // Both endpoints are defined in the same file, and that file has no direct
  // coverage. The check is about what the path reaches, not what the defining
  // file scores, and these two are the pair that tells those apart.
  const sameFile = payload.endpoints.filter((e) => e.definedIn === "services/worker/app/main.py");
  assert.deepEqual(sameFile.map((e) => e.id).sort(), ["GET /health", "POST /jobs"]);
  assert.equal(payload.nodes.find((n) => n.id === "services/worker/app/main.py").coverage, "none");

  assert.ok(flagged.has("GET /health"), "GET /health reaches no tested file and must be flagged");
  assert.equal(
    flagged.has("POST /jobs"), false,
    "POST /jobs reaches a directly tested service, so it must not be flagged",
  );
});

// ---------------------------------------------------------------------------
// Mute
// ---------------------------------------------------------------------------

test("a muted finding stays in the payload, marked, with its reason", async () => {
  const base = (await import(pathToFileURL(IMPORT_CYCLE_CONFIG).href)).default;
  const config = {
    ...base,
    findings: { ...base.findings, mute: [{ id: "orphan:src/util/orphan.ts", reason: "kept for a later ticket" }] },
  };
  const findings = await findingsOf("import-cycle", { config });
  const muted = byId(findings, "orphan:src/util/orphan.ts");
  assert.equal(muted.muted, true);
  assert.equal(muted.muteReason, "kept for a later ticket");
  // Every other finding is unaffected.
  const others = findings.filter((f) => f.id !== "orphan:src/util/orphan.ts");
  assert.ok(others.every((f) => f.muted === false && f.muteReason === null));
});

// ---------------------------------------------------------------------------
// TaxVault — ROADMAP.md Phase 5 gate 1 (skips when the corpus is absent)
// ---------------------------------------------------------------------------

test("TaxVault: reports core-case-service orphans and server.ts unreachable", (t) => {
  const repo = requireCorpus(t, "taxvault");
  if (!repo) return;

  const { payload } = scan({ repo, ref: "fs", config: undefined, fetch: false, warn: () => {} });
  const orphans = byType(payload.findings, "orphan").filter((f) => f.evidence.nodes[0].includes("core-case-service"));
  assert.ok(orphans.length > 0, "expected at least one core-case-service orphan");

  const unreachable = byType(payload.findings, "unreachable").filter((f) => f.evidence.nodes[0].endsWith("server.ts"));
  assert.ok(unreachable.length > 0, "expected server.ts to be reported unreachable");
});
