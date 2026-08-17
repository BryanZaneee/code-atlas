/**
 * Golden payloads.
 *
 * mini-monorepo is the permanent, CI-enforced golden. taxvault is the Phase 0
 * equivalence check with a defined end: it proves the lift-and-shift changed
 * nothing, and once Phase 2's general path reproduces it from config alone it
 * demotes to an opt-in corpus assertion.
 *
 * Re-baseline deliberately: UPDATE_GOLDEN=1 npm test, then READ the diff before
 * committing it. A golden re-baselined without reading the diff is worse than
 * no golden, because it looks like coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { scan } from "../src/build/build.mjs";
import { checkGolden, firstDiff, serialize, scanFixture, corpusRepo, GOLDEN_DIR } from "./helpers.mjs";
import { readFileSync } from "node:fs";

test("mini-monorepo payload matches its golden", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const r = checkGolden("mini-monorepo", payload);
  if (r.updated) return;
  assert.ok(!r.missing, `golden missing: ${r.file} — create it with UPDATE_GOLDEN=1`);
  assert.ok(r.ok, `payload drifted from ${path.basename(r.file)}\n${firstDiff(r.expected, r.actual)}`);
});

/**
 * The lift-and-shift guarantee, kept alive past the phase that earned it.
 *
 * test/golden/taxvault.prototype.json is frozen forever: it is the prototype's
 * output, and the observed facts in it -- nodes, edges, endpoints, coverage --
 * must never drift. Later phases legitimately ADD to the payload, so those
 * additions are listed here explicitly and stripped before comparing. The list
 * only ever grows with a deliberate, reviewed entry; anything else moving is a
 * regression in what the scanner reports.
 */
const ADDED_TOP = ["views", "theme"];                          // phase 1
const ADDED_META = ["schemaVersion", "acquisition", "suiteCount",
  // phase 2.5: the map's own coverage, so the chrome can state it permanently.
  "unsortedCount", "unresolvedCount", "derivedCount"];
// phase 1: the viewer used to sniff a step's prose for two phrases to decide
// whether to highlight it; the curated data says so outright now.
const ADDED_STEP = ["warn"];
// phase 2: every node records the rule that placed it. Additive — the layer and
// service themselves must still match the prototype exactly, and they do.
const ADDED_NODE = ["layerWhy", "serviceWhy",
  // phase 2.5: the flow index read from the node's end. Absent when empty, so
  // deleting it is a no-op on the nodes no flow touches.
  "travelledBy"];
// phase 2.5: a stable two-character district name, and the district-hierarchy
// field PLAN.md ships ahead of the layout that consumes it.
const ADDED_GROUP = ["code", "parentId"];

/**
 * The one deliberate CORRECTION to the prototype's observed facts, as opposed to
 * the additions above.
 *
 * The prototype decided a file's language with a three-way test and markdown as
 * the else branch, which held only while the kept set was `.ts .py .sql .md`. A
 * `.json` contract file — kept on purpose, because two languages import it —
 * was therefore reported as prose: counted in `docCount` instead of
 * `fileCount`, its lines missing from `lineCount`, and hidden behind the DOCS
 * toggle. Phase 2 widens the kept set, which would have made that silent bug
 * systematic, so it is fixed rather than preserved.
 *
 * Reversing exactly that correction here keeps every other byte of the payload
 * under comparison. It is deliberately narrow: it names one bug and undoes one
 * bug.
 */
function undoJsonLangFix(p) {
  const json = p.nodes.filter((n) => n.lang === "json");
  for (const n of json) n.lang = "md";
  p.meta.fileCount -= json.length;
  p.meta.docCount += json.length;
  p.meta.lineCount -= json.reduce((a, n) => a + n.loc, 0);
}

test("taxvault's observed facts have not drifted from the prototype", async (t) => {
  const repo = corpusRepo("taxvault");
  if (!repo) return t.skip("taxvault not present -- the corpus lives outside this repo");

  const config = (await import("../examples/taxvault.config.mjs")).default;
  const { payload } = scan({ repo, ref: "22595f3a", config, fetch: false });

  // Deleting a key leaves the order of the rest intact, so this stays a plain
  // string comparison rather than a structural walk.
  const stripped = structuredClone(payload);
  // Phase 2, and the one entry here that is not a new field: the prototype
  // assigned five root-level files to a service it never declared, so the viewer
  // filtered them out with no checkbox to bring them back — PLAN.md failure mode
  // #1, frozen into this golden. Reconciliation declares the id the config
  // already used rather than moving the files, so every node's service is
  // unchanged and the services list gains one marked entry. Dropping the marked
  // entries compares like for like.
  stripped.services = stripped.services.filter((s) => !s.synthesized);
  undoJsonLangFix(stripped);
  for (const k of ADDED_TOP) delete stripped[k];
  for (const k of ADDED_META) delete stripped.meta[k];
  for (const n of stripped.nodes) for (const k of ADDED_NODE) delete n[k];
  for (const g of stripped.groups) for (const k of ADDED_GROUP) delete g[k];
  for (const f of stripped.flows) for (const st of f.steps) for (const k of ADDED_STEP) delete st[k];

  const expected = readFileSync(path.join(GOLDEN_DIR, "taxvault.prototype.json"), "utf8");
  const actual = serialize(stripped);
  assert.equal(actual, expected, `the scanner's output drifted\n${firstDiff(expected, actual)}`);
});

test("meta carries the fields later phases added", async (t) => {
  const repo = corpusRepo("taxvault");
  if (!repo) return t.skip("taxvault not present");

  const config = (await import("../examples/taxvault.config.mjs")).default;
  const { payload } = scan({ repo, ref: "22595f3a", config, fetch: false });

  assert.equal(payload.meta.schemaVersion, 1);
  assert.deepEqual(payload.meta.acquisition, {
    mode: "ref",
    ref: "22595f3a",
    commit: "22595f3",
    dirty: false,
  });
  // Four suite kinds, which the viewer used to print as a literal "4".
  assert.equal(payload.meta.suiteCount, 4);
  // The map's own coverage, on a target that actually has curated flows: every
  // hop of them is modeled, so DERIVED must be a real number and not zero.
  assert.ok(payload.meta.derivedCount > 0, "curated flow hops are modeled, not observed");
  assert.ok(payload.meta.derivedCount <= payload.flows.reduce((a, f) => a + f.steps.length, 0));
  assert.equal(payload.meta.unresolvedCount, 0);
  // The flow index, on a target that has nine of them: some nodes are on a
  // flow, most are not, and the ones that are name flows that exist.
  const travelled = payload.nodes.filter((n) => n.travelledBy);
  const flowIds = new Set(payload.flows.map((f) => f.id));
  assert.ok(travelled.length > 0 && travelled.length < payload.nodes.length);
  assert.ok(travelled.every((n) => n.travelledBy.every((id) => flowIds.has(id))));
  assert.deepEqual(payload.views.map((v) => v.id), ["structure", "api", "engagement", "tests"]);
  assert.equal(payload.views.find((v) => v.id === "engagement").showPhase, true);
  assert.equal(payload.views.find((v) => v.id === "api").showPhase, false);
});
