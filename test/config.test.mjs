/**
 * Config normalization and classification provenance.
 *
 * The pipeline downstream of the loader reads exactly one shape. These tests are
 * that contract: whatever the config looked like going in, `layerOf` and
 * `serviceOf` come out as provenanced total functions.
 *
 * "Total" is the load-bearing word. PLAN.md's failure mode #1 is a classifier
 * that returns something the payload does not contain, which filters every node
 * out of the viewer with no checkbox left to bring them back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/load.mjs";
import { classifyLayer, makeServiceOf } from "../src/model/classify.mjs";
import { DEFAULT_LAYER_RULES } from "../src/config/defaults.mjs";

test("an empty config still yields a working classifier", () => {
  const c = loadConfig();
  assert.ok(c.layers.length > 0);
  assert.ok(c.services.length > 0);
  assert.equal(typeof c.layerOf, "function");
  assert.equal(typeof c.serviceOf, "function");
  assert.equal(typeof c.testKind, "function");
});

test("defaults place the conventional directories", () => {
  const { layerOf } = loadConfig();
  const layer = (p) => layerOf(p).layer;
  assert.equal(layer("src/routes/users.ts"), "route");
  assert.equal(layer("src/services/user-service.ts"), "service");
  assert.equal(layer("src/repository/user-repo.ts"), "repository");
  assert.equal(layer("src/middleware/auth.ts"), "middleware");
  assert.equal(layer("app/controllers/document.py"), "controller");
  assert.equal(layer("README.md"), "docs");
  assert.equal(layer("db/0001_init.sql"), "migration");
  assert.equal(layer("src/server.ts"), "entry");
});

/**
 * Order is the design. A test file inside services/ is a test; a config file
 * inside src/ is tooling; index.ts inside routes/ is a route. Each of these is a
 * first-match-wins consequence, so each is worth pinning.
 */
test("a test file wins over the directory it sits in", () => {
  const { layerOf } = loadConfig();
  assert.equal(layerOf("src/services/user-service.test.ts").layer, "test");
  assert.equal(layerOf("app/services/test_job_service.py").layer, "test");
  assert.equal(layerOf("src/services/vitest.config.ts").layer, "tooling");
  assert.equal(layerOf("src/routes/index.ts").layer, "route");
});

test("every placement carries the reason it was placed", () => {
  const { layerOf, serviceOf } = loadConfig();
  const r = layerOf("src/routes/users.ts");
  assert.equal(r.layer, "route");
  assert.match(r.why, /routing directory/);
  assert.equal(r.matched, true);
  assert.match(serviceOf("anything.ts").why, /fell back|under service root/);
});

/**
 * The graceful-degradation guarantee: an unmatched path still gets a layer, and
 * still says so. "Everything landed in tooling because nothing matched" is a
 * legible failure; a blank screen is not.
 */
test("a path matching no rule falls back and says so", () => {
  const r = classifyLayer("weird/unknowable/thing.xyz", DEFAULT_LAYER_RULES);
  assert.equal(r.layer, "tooling");
  assert.equal(r.matched, false);
  assert.match(r.why, /no rule matched/);
});

test("an unmatched path prefers a layer-named directory over the fallback", () => {
  const rules = [{ layer: "service", dirs: ["services"] }];
  const r = classifyLayer("pkg/service/thing.rb", rules);
  assert.equal(r.layer, "service");
  assert.equal(r.matched, false);
  assert.match(r.why, /derived from directory/);
});

test("serviceOf is total — the fallback service always exists", () => {
  const services = [
    { id: "api", root: "apps/api" },
    { id: "app", root: null },
  ];
  const of = makeServiceOf(services);
  const ids = new Set(services.map((s) => s.id));
  for (const p of ["apps/api/src/x.ts", "somewhere/else.ts", "x.ts", ""]) {
    assert.ok(ids.has(of(p).service), `${p} escaped the service list`);
  }
  assert.equal(of("apps/api/src/x.ts").service, "api");
  assert.equal(of("somewhere/else.ts").service, "app");
});

test("a nested service root wins over the one containing it", () => {
  const of = makeServiceOf([
    { id: "outer", root: "apps" },
    { id: "inner", root: "apps/api" },
    { id: "fallback", root: null },
  ]);
  assert.equal(of("apps/api/src/x.ts").service, "inner");
  assert.equal(of("apps/web/src/x.ts").service, "outer");
});

/**
 * Both example configs are the function shape. They keep working, and their
 * provenance degrades honestly rather than claiming a rule number it cannot know.
 */
test("a config's own classify() is honoured, and says that is what happened", () => {
  const { layerOf } = loadConfig({ classify: (p) => (p.endsWith(".py") ? "service" : "other") });
  const hit = layerOf("x.py");
  assert.equal(hit.layer, "service");
  assert.equal(hit.matched, true);
  assert.match(hit.why, /classify\(\)/);

  // "other" is the sentinel a hand-written classify() returns for no-match.
  const miss = layerOf("x.ts");
  assert.equal(miss.layer, "tooling");
  assert.equal(miss.matched, false);
});

test("a config file overrides the defaults it names and inherits the rest", () => {
  const keep = /\.only$/;
  const c = loadConfig({ keep });
  assert.equal(c.keep, keep);
  assert.ok(c.exclude.length > 0, "exclude still came from the defaults");
  assert.equal(c.layerOf("src/routes/x.ts").layer, "route");
});

test("CLI overrides win over the config file", () => {
  const c = loadConfig({ keep: /\.config$/ }, { overrides: { keep: /\.cli$/ } });
  assert.equal(String(c.keep), "/\\.cli$/");
});
