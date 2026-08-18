/**
 * Path derivation.
 *
 * A derived path is the tool's own inference, not an observation, and the whole
 * point of shipping one is that a reader can tell which hops are justified and
 * which are guesses. So the invariants worth pinning are the ones that keep
 * that claim honest: a hop labelled `wired` really was wired, the request leg
 * really does move down the layers, and the response leg is the admitted
 * placeholder it says it is rather than a second inference wearing the same
 * clothes.
 *
 * Driven off in-repo fixtures on purpose. The calibration gate next door
 * measures derivation against nine hand-curated TaxVault flows, which is the
 * stronger check — and it skips entirely on a fresh clone, so it cannot be the
 * only one. `derive.mjs` is the second-largest file in the repository; it had
 * no test that ran in CI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanFixture } from "./helpers.mjs";

const steps = (ep) => ep.derivedPath?.steps ?? [];
const idOf = (payload, i) => payload.nodes[i]?.id;

/** The Phase 6 gate: every endpoint, on every target, gets a path worth drawing. */
test("every endpoint derives a path of at least two hops", async () => {
  for (const fixture of ["express-js", "mini-monorepo"]) {
    const { payload } = await scanFixture(fixture);
    assert.ok(payload.endpoints.length > 0, `${fixture}: no endpoints to derive from`);
    for (const ep of payload.endpoints) {
      assert.ok(steps(ep).length >= 2, `${fixture} ${ep.id}: derived ${steps(ep).length} hop(s)`);
    }
  }
});

/**
 * A path starts at its endpoint and reaches the file that declares it.
 *
 * Not necessarily in one hop: the seed is the mount chain, so a router mounted
 * two levels deep is entered at the outermost file that mounts it and walked
 * down. Those hops are the ones derivation can prove — `app.use("/admin", r)`
 * is a registration somebody wrote — so they must all claim `wired`.
 */
test("a path starts at its endpoint and walks the mount chain to the defining file", async () => {
  const { payload } = await scanFixture("express-js");
  for (const ep of payload.endpoints) {
    const all = steps(ep);
    assert.equal(idOf(payload, all[0].from), ep.id, `${ep.id}: path does not start at the endpoint`);

    const request = all.filter((s) => s.kind !== "response");
    const reached = request.map((s) => idOf(payload, s.to));
    assert.ok(reached.includes(ep.definedIn), `${ep.id}: never reaches ${ep.definedIn}, only ${reached.join(" -> ")}`);

    // Everything up to and including the defining file is proven wiring.
    for (const s of request.slice(0, reached.indexOf(ep.definedIn) + 1)) {
      assert.equal(s.certainty, "wired", `${ep.id}: a mount-chain hop claimed ${s.certainty}`);
    }
  }
});

/**
 * `inferred` is the boolean the renderer branches on and `certainty` is the
 * three-state detail behind it. If they can disagree, one of them is decoration.
 */
test("inferred is true exactly when certainty is inferred", async () => {
  const { payload } = await scanFixture("express-js");
  for (const ep of payload.endpoints) {
    for (const s of steps(ep)) {
      assert.equal(s.inferred, s.certainty === "inferred", `${ep.id}: ${s.certainty} vs inferred=${s.inferred}`);
    }
  }
});

/**
 * The request leg moves down the layer stack — route before service before
 * repository — and never back up. That ordering is the entire basis on which
 * the spine is chosen, so if it does not hold the path is arbitrary.
 */
test("the request leg never moves back up the layer stack", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const rank = new Map(payload.layers.map((l) => [l.id, l.rank]));
  const layerOf = (i) => rank.get(payload.nodes[i]?.layer);
  for (const ep of payload.endpoints) {
    const request = steps(ep).filter((s) => s.kind !== "response");
    for (const s of request) {
      const from = layerOf(s.from), to = layerOf(s.to);
      if (from == null || to == null) continue;
      // The endpoint node itself sits at rank -1, above everything by design.
      assert.ok(to >= from, `${ep.id}: hop rose from rank ${from} to ${to}`);
    }
  }
});

/**
 * The response leg is documented as a blind reversal of the last few request
 * hops — a placeholder honest about being one. Two things have to stay true for
 * that to keep being honest: it never claims to be observed, and it does not
 * grow into a second inference nobody calibrated.
 */
test("the response leg is a short, wholly inferred mirror", async () => {
  for (const fixture of ["express-js", "mini-monorepo"]) {
    const { payload } = await scanFixture(fixture);
    for (const ep of payload.endpoints) {
      const all = steps(ep);
      const response = all.filter((s) => s.kind === "response");
      assert.ok(response.length <= 3, `${fixture} ${ep.id}: response leg is ${response.length} hops`);
      for (const s of response) {
        assert.equal(s.certainty, "inferred", `${fixture} ${ep.id}: a response hop claimed ${s.certainty}`);
      }
      // Once the response leg starts it does not go back to requesting.
      const firstResponse = all.findIndex((s) => s.kind === "response");
      if (firstResponse !== -1) {
        assert.ok(
          all.slice(firstResponse).every((s) => s.kind === "response"),
          `${fixture} ${ep.id}: a request hop follows the response leg`,
        );
      }
    }
  }
});

/** Totality. A repo with nothing to derive from must produce a map, not a throw. */
test("a repo with no endpoints derives nothing and does not throw", async () => {
  const { payload } = await scanFixture("hostile-py");
  assert.equal(payload.endpoints.length, 0);
  assert.deepEqual(payload.derivedFlows, []);
  assert.ok(payload.nodes.length > 0);
});

/** Derivation is part of the payload, so it carries the payload's determinism rule. */
test("deriving the same repo twice gives the same paths", async () => {
  const a = (await scanFixture("express-js")).payload;
  const b = (await scanFixture("express-js")).payload;
  assert.equal(JSON.stringify(a.derivedFlows), JSON.stringify(b.derivedFlows));
});
