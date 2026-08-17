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
 * The Phase 0 gate: our payload must equal the prototype's, byte for byte,
 * except generatedAt and the two meta fields this phase deliberately adds.
 * Deleting a key leaves the order of the rest intact, so the comparison stays
 * a plain string equality.
 */
test("taxvault payload is identical to the prototype", async (t) => {
  const repo = corpusRepo("taxvault");
  if (!repo) return t.skip("taxvault not present — the corpus lives outside this repo");

  const config = (await import("../examples/taxvault.config.mjs")).default;
  const { payload } = scan({ repo, ref: "22595f3a", config, fetch: false });

  const stripped = structuredClone(payload);
  delete stripped.meta.schemaVersion;
  delete stripped.meta.acquisition;

  const expected = readFileSync(path.join(GOLDEN_DIR, "taxvault.json"), "utf8");
  const actual = serialize(stripped);
  assert.equal(actual, expected, `lift-and-shift changed the payload\n${firstDiff(expected, actual)}`);
});

test("the two meta fields phase 0 adds are the only additions", async (t) => {
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
});
