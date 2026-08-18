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
import { diagnose } from "../src/build/build.mjs";
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

test("Next.js App Router: route.ts and page.tsx are the route, groups stripped, params converted", async () => {
  const { payload } = await scanFixture("file-routes");
  const routes = payload.endpoints.map((e) => `${e.method} ${e.path}`).sort();
  assert.deepEqual(routes, [
    "DELETE /api/items/:id",
    "GET /",
    "GET /about",
    "GET /api/files/:slug*",
    "GET /api/items",
    "GET /api/items/:id",
    "POST /api/items",
  ]);
  assert.ok(
    !routes.some((r) => r.includes("(marketing)") || r.includes("(dashboard)")),
    "a route group leaked into a path",
  );
  assert.ok(
    !payload.endpoints.some((e) => e.definedIn.includes("components/Widget")),
    "a component file sitting in a route directory became a route",
  );
});

test("every endpoint carries a line number, and a route.ts's methods point at their own export", async () => {
  const { payload } = await scanFixture("file-routes");
  for (const e of payload.endpoints) assert.equal(typeof e.line, "number");

  const items = payload.endpoints.filter((e) => e.definedIn.endsWith("app/api/items/route.ts"));
  const get = items.find((e) => e.method === "GET");
  const post = items.find((e) => e.method === "POST");
  assert.ok(get.line < post.line, "GET is declared before POST in the fixture, so its line should be smaller");

  const home = payload.endpoints.find((e) => e.path === "/");
  assert.equal(home.line, 1, "a page.tsx route has no single declaring line — jump to the top of the file");
});

test("{id} and :id collapse into one logical node, and `path` stays literal", async () => {
  const { payload } = await scanFixture("param-styles");
  // Two registrations of "/items" (one `{id}`, one `:id`) must draw one node,
  // not two — so three app.get() calls yield two endpoints, not three.
  assert.equal(payload.endpoints.length, 2);
  const paths = payload.endpoints.map((e) => e.path).sort();
  // `path` is documented as literal: the first declaration's own syntax
  // survives untouched, it is only the dedupe that treats the two as one.
  assert.deepEqual(paths, ["/items/{id}", "/users/:id"]);
});

test("a non-literal path and a helper-registered literal path are both skipped and reported, never guessed", async () => {
  const { payload } = await scanFixture("route-skips");
  assert.equal(payload.endpoints.length, 0, "no phantom endpoint should be emitted");

  const skips = payload.endpoints.skips;
  assert.equal(skips.length, 3);

  const nonLiteral = skips.filter((s) => s.reason === "non-literal path");
  assert.equal(nonLiteral.length, 1);
  assert.ok(nonLiteral[0].file.endsWith("_shared.ts"));

  const helperRegistered = skips.filter((s) => s.reason.includes("helper-registered"));
  assert.equal(helperRegistered.length, 2);
  assert.ok(helperRegistered.every((s) => s.file.endsWith("routes/items.ts")));
});

test("skipped endpoint registrations are reported by atlas scan, grouped by file", async () => {
  const { payload, diagnostics } = await scanFixture("route-skips");
  const out = [];
  diagnose(payload, diagnostics, (...m) => out.push(m.join(" ")));

  const header = out.find((l) => l.startsWith("atlas: endpoint registrations skipped"));
  assert.ok(header, "no skip summary line");
  assert.ok(header.endsWith("=3"));
  assert.ok(out.some((l) => l.includes("_shared.ts")));
  assert.ok(out.some((l) => /^ +2 .*routes\/items\.ts$/.test(l)));
});
