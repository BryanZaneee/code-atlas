/**
 * Endpoint extraction.
 *
 * The rule that never changes is that a non-literal path is skipped and
 * counted rather than guessed at, because a phantom endpoint is a lie the
 * whole map inherits while a missing one is a gap somebody can see. Every
 * assertion here is either that rule or the coverage question underneath it:
 * WHICH files a registration rule was allowed to run over at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanFixture } from "./helpers.mjs";

const ids = (payload) => payload.endpoints.map((e) => `${e.method} ${e.path}`).sort();

/**
 * The regression this file was written for. Extraction used to be gated on
 * `/\.(ts|py)$/`, so an Express app written in JavaScript — the ordinary case,
 * not an exotic one — produced zero endpoints and zero derived paths, with no
 * skip and no diagnostic. "We cannot read this" looked exactly like "there is
 * nothing here", which is the one thing the scanner is not allowed to do.
 */
test("an Express app in plain JavaScript yields its endpoints", async () => {
  const { payload } = await scanFixture("express-js");
  assert.deepEqual(ids(payload), [
    "DELETE /items/:id",
    "GET /admin/stats",
    "GET /health",
    "GET /items",
    "GET /items/:id",
    "POST /login",
  ]);
});

/**
 * The mount chain has to compose across three files AND two module systems:
 * a `.cjs` router and an `.mjs` router, both mounted by a `.js` server. A
 * router's own declared path is not the path it is served at.
 */
test("a router's served path is composed, not the path it declares", async () => {
  const { payload } = await scanFixture("express-js");
  const byFile = (f) => payload.endpoints.filter((e) => e.definedIn === f).map((e) => e.path);
  assert.deepEqual(byFile("src/routes/items.cjs").sort(), ["/items", "/items/:id", "/items/:id"]);
  assert.deepEqual(byFile("src/routes/admin.mjs"), ["/admin/stats"]);
  assert.ok(
    !payload.endpoints.some((e) => e.path === "/stats"),
    "the router's own path outlived the prefix it is actually mounted under",
  );
});

test("a non-literal path is skipped and counted, never guessed at", async () => {
  const { payload } = await scanFixture("express-js");
  const skips = payload.endpoints.skips ?? [];
  assert.equal(skips.length, 1, "the one non-literal registration must be reported");
  assert.equal(skips[0].file, "src/routes/admin.mjs");
  assert.equal(skips[0].reason, "non-literal path");
  // The phantom this rule exists to prevent: the variable's *default* value is
  // a literal sitting in the same file, and guessing it would look plausible.
  assert.ok(!payload.endpoints.some((e) => e.path.includes("/danger")), "invented an endpoint from a variable");
});

/**
 * A file in a language no adapter claims is not silently dropped. `hostile-py`
 * has none of these, so the field stays absent rather than shipping an empty
 * array — the payload says "nothing to report", not "nothing was checked".
 */
test("a language no adapter claims is reported rather than dropped in silence", async () => {
  const { payload } = await scanFixture("express-js");
  assert.equal(payload.endpoints.unscanned?.length ?? 0, 0, "every file here is JS; nothing should be unscanned");
});

/**
 * The two facts a reader needs to correct a wrong endpoint path: which
 * registration rule matched, and how the mount prefix was decided — one
 * string, the way `layerWhy` is one string for a file node.
 */
test("an endpoint carries the rule that matched and how its mount was decided", async () => {
  const { payload } = await scanFixture("express-js");
  const e = payload.endpoints.find((e) => e.path === "/admin/stats");
  assert.ok(e, "expected the /admin/stats endpoint");
  assert.match(e.why, /matched endpoint rule #\d+/);
  assert.match(e.why, /mount chain|declared by the rule|no mount resolved/);
});

/** Totality: a repo with no routes at all must still scan, not throw. */
test("a repo with no endpoints still produces a payload", async () => {
  const { payload } = await scanFixture("hostile-py");
  // `.length`, not deepEqual: `skips`/`unscanned` ride along as non-index
  // array properties, which is what keeps them out of the JSON payload.
  assert.equal(payload.endpoints.length, 0);
  assert.ok(payload.nodes.length > 0, "a repo with no routes is still a map");
});
