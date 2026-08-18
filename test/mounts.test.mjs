/**
 * Mount-chain resolution.
 *
 * The path a request really reaches is assembled across files: a router
 * declares `/items`, a second file mounts it at `/api`, and neither one
 * contains `/api/items`. Getting that wrong is not a cosmetic error — an
 * endpoint reported at a path nobody can call is a phantom, and phantoms are
 * the one thing this tool must never emit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMounts } from "../src/model/mounts.mjs";
import { scanFixture } from "./helpers.mjs";

const ids = (payload) => payload.endpoints.map((e) => e.id).sort();

test("a two-level mount chain composes into the path actually served", async () => {
  const { payload } = await scanFixture("flat-app");
  assert.deepEqual(ids(payload), [
    "DELETE /api/items/:id",   // app -> /api, items -> /items, admin -> /:id
    "GET /api/items",
    "GET /health",             // registered on the root app, so no prefix
    "POST /api/items",
  ]);
});

test("a route is reported once, not once per pass of the fixpoint", async () => {
  // The deepest route is reachable only after its parent's own prefix is
  // known. Treating a not-yet-resolved parent as a root publishes the child at
  // a truncated path that then survives alongside the real one.
  const { payload } = await scanFixture("flat-app");
  const seen = ids(payload);
  assert.equal(new Set(seen).size, seen.length, `duplicate endpoints: ${seen.join(", ")}`);
  assert.ok(!payload.endpoints.some((e) => e.path === "/items/:id"), "the truncated path outlived the real one");
});

/** A ctx of literal sources, which is all resolveMounts reads. */
function ctxOf(files, layerOf) {
  const src = new Map(Object.entries(files));
  return {
    paths: [...src.keys()],
    fileSet: new Set(src.keys()),
    src,
    config: { layerOf },
    warn: () => {},
  };
}

test("a test harness mounting a router does not become a mount prefix", () => {
  // A harness routinely mounts a router at "/" to exercise it in isolation.
  // That is how the test reaches the routes, never how the application serves
  // them, and letting it in reports every route at a second path nobody can
  // call. Driven directly rather than through a fixture, because a fixture
  // carrying a test file stops being the repo-with-no-tests case elsewhere.
  const files = {
    "app.ts": `import { itemsRouter } from "./items.js";\napp.route("/api", itemsRouter);\n`,
    "items.ts": `export const itemsRouter = {};\n`,
    "items.test.ts": `import { itemsRouter } from "./items.js";\nharness.route("/", itemsRouter);\n`,
  };
  const layerOf = (p) => ({ layer: p.endsWith(".test.ts") ? "test" : "route" });

  const withTests = resolveMounts(ctxOf(files, layerOf));
  assert.deepEqual([...withTests.get("items.ts")], ["/api"]);

  // And the harness really would have contributed one, without the guard.
  const ifTestsCounted = resolveMounts(ctxOf(files, () => ({ layer: "route" })));
  assert.deepEqual([...ifTestsCounted.get("items.ts")].sort(), ["/", "/api"]);
});

test("a config that declares a mount is not overruled by discovery", async () => {
  // mini-monorepo's config states "/api". Discovery is for repositories that
  // said nothing; a config naming the prefix is stating a fact about its own
  // repository and wins outright.
  const { payload } = await scanFixture("mini-monorepo");
  assert.ok(payload.endpoints.length > 0);
  for (const e of payload.endpoints) {
    assert.ok(
      e.path.startsWith("/api/") || !e.path.startsWith("/api"),
      `${e.id} lost its configured mount`,
    );
  }
  assert.ok(payload.endpoints.some((e) => e.path.startsWith("/api/")), "the configured mount vanished");
});
