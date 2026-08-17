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
const ADDED_META = ["schemaVersion", "acquisition", "suiteCount"];
// phase 1: the viewer used to sniff a step's prose for two phrases to decide
// whether to highlight it; the curated data says so outright now.
const ADDED_STEP = ["warn"];

test("taxvault's observed facts have not drifted from the prototype", async (t) => {
  const repo = corpusRepo("taxvault");
  if (!repo) return t.skip("taxvault not present -- the corpus lives outside this repo");

  const config = (await import("../examples/taxvault.config.mjs")).default;
  const { payload } = scan({ repo, ref: "22595f3a", config, fetch: false });

  // Deleting a key leaves the order of the rest intact, so this stays a plain
  // string comparison rather than a structural walk.
  const stripped = structuredClone(payload);
  for (const k of ADDED_TOP) delete stripped[k];
  for (const k of ADDED_META) delete stripped.meta[k];
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
  assert.deepEqual(payload.views.map((v) => v.id), ["structure", "api", "engagement", "tests"]);
  assert.equal(payload.views.find((v) => v.id === "engagement").showPhase, true);
  assert.equal(payload.views.find((v) => v.id === "api").showPhase, false);
});
