/**
 * Regression gate for derivation calibration (test/calibrate.mjs).
 *
 * Pinned to the same commit the golden files use, so a drift-causing change in
 * the corpus repository itself never fails this test — only a change to
 * src/model/derive.mjs's actual behaviour can.
 *
 * The floor below is the measured aggregate as of this phase, not a target:
 * TaxVault wires its controllers and services through dependency injection
 * (built once, passed as constructor/function parameters) rather than
 * importing them per route file, which import-graph derivation cannot see —
 * that ceiling is real, not a bug, and most of `missed` is exactly that. A
 * change that drops below the floor is a regression to look at; a change that
 * legitimately raises it should move the floor up with the reason recorded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/build/build.mjs";
import { requireCorpus, scanTaxvault, scanFastapiTemplate, scanFixture } from "./helpers.mjs";
import { calibrate } from "./calibrate.mjs";
import { FLOWS as FASTAPI_FLOWS } from "../examples/fastapi-template.flows.mjs";

test("derivation calibration does not regress against the 9 curated TaxVault flows", async (t) => {
  const repo = requireCorpus(t, "taxvault");
  if (!repo) return;

  const { payload } = await scanTaxvault(repo);
  const { flows, aggregate } = calibrate(payload);

  assert.equal(flows.length, 9, "all 9 curated flows must be diffed, not a subset");
  for (const f of flows) assert.ok(!f.error, `flow "${f.id}": ${f.error}`);

  // Measured against 22595f3a: precision ~17%, recall ~12%, tp=11 of 93 curated
  // hops, derived=64 request-leg hops total. Thresholds sit a little under the
  // measured value, not on top of it, so an unrelated one-hop wobble from a
  // tie-break change does not fail the suite.
  assert.ok(aggregate.precision >= 0.15, `precision regressed: ${aggregate.precision}`);
  assert.ok(aggregate.recall >= 0.10, `recall regressed: ${aggregate.recall}`);
  assert.ok(aggregate.tp >= 10, `true positives regressed: ${aggregate.tp}`);
});

/**
 * The second corpus, added so the published numbers rest on more than one
 * repository.
 *
 * fastapi/full-stack-fastapi-template is the opposite wiring style to
 * TaxVault: collaborators are imported at module scope rather than injected,
 * which is precisely the shape import-graph derivation is supposed to be good
 * at. It scores better than TaxVault, and still not well, which is the useful
 * result: the ceiling is not only dependency injection.
 *
 * What it gets wrong here is mostly ordering and plumbing. Derivation jumps
 * from the endpoint straight to the route file, where the curated path walks
 * the real ASGI chain (app -> api_router -> route), and it reaches the
 * datastore through `core/__init__.py` because that barrel is what the import
 * graph actually contains. Both are honest disagreements about the same edges,
 * not fabrications, which is why `invented` is high while `wrongOrder` is zero.
 */
test("derivation calibration does not regress against the 5 curated template flows", async (t) => {
  const repo = requireCorpus(t, "fastapi-template");
  if (!repo) return;

  const { payload } = await scanFastapiTemplate(repo);
  const { flows, aggregate } = calibrate(payload, FASTAPI_FLOWS);

  assert.equal(flows.length, 5, "all 5 curated flows must be diffed, not a subset");
  for (const f of flows) assert.ok(!f.error, `flow "${f.id}": ${f.error}`);

  // Measured at cb740b6: precision ~23%, recall ~16%, tp=7 of 44 curated hops,
  // derived=30 request-leg hops. Floors are the measured value rounded down,
  // for the same reason TaxVault's sit under its own: a tie-break change that
  // moves one hop should not fail the suite.
  assert.ok(aggregate.precision >= 0.20, `precision regressed: ${aggregate.precision}`);
  assert.ok(aggregate.recall >= 0.15, `recall regressed: ${aggregate.recall}`);
  assert.ok(aggregate.tp >= 6, `true positives regressed: ${aggregate.tp}`);
});

/**
 * The honesty invariant, which matters more than any calibration number.
 *
 * A derived path is MODELLED. `wired` claims a registration this tool followed,
 * `imported` claims a real import edge justifies the hop, and `inferred` admits
 * a gap. The first two are claims about observed facts, so they have to be
 * checkable — and `imported` is the one that can quietly drift, because the
 * payload's `edges` array also carries curated flow and extraEdge
 * relationships. A hop justified by one of those is somebody's assertion, not
 * an import, and calling it `imported` would relabel modelled wiring observed.
 */
test("every hop claiming `imported` is backed by a real import edge", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const imports = new Set(
    payload.edges.filter((e) => e.kind === "import").map((e) => `${e.from}|${e.to}`),
  );

  let checked = 0;
  for (const ep of payload.endpoints) {
    for (const s of ep.derivedPath?.steps ?? []) {
      assert.ok(
        ["wired", "imported", "inferred"].includes(s.certainty),
        `${ep.id}: unknown certainty ${s.certainty}`,
      );
      if (s.certainty !== "imported") continue;
      checked++;
      const from = payload.nodes[s.from]?.id, to = payload.nodes[s.to]?.id;
      assert.ok(
        imports.has(`${from}|${to}`),
        `${ep.id}: hop ${from} -> ${to} claims "imported" with no import edge to justify it`,
      );
    }
  }
  assert.ok(checked > 0, "no imported hops in the fixture — the assertion proved nothing");
});
