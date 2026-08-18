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
import { classifyLayer, makeServiceOf, reconcileServices } from "../src/model/classify.mjs";
import { DEFAULT_EXCLUDE } from "../src/config/defaults.mjs";
import { detectServices } from "../src/config/detect.mjs";
import { globToRe } from "../src/model/tests.mjs";
import { FIXTURE_DIR } from "./helpers.mjs";

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
test("a path matching no rule lands in unsorted and says so", () => {
  const { layerOf, layers } = loadConfig();
  const r = layerOf("weird/unknowable/thing.xyz");
  // Its own column, never "tooling": the tool is admitting it did not recognise
  // the file, not claiming the file is a build script.
  assert.equal(r.layer, "unsorted");
  assert.equal(r.matched, false);
  assert.match(r.why, /no rule matched/);
  assert.ok(layers.some((l) => l.id === "unsorted"), "the fallback layer must be a real column");
});

test("a config's own classify() keeps the fallback its shape has always meant", () => {
  const { layerOf } = loadConfig({ classify: () => "other" });
  assert.equal(layerOf("x.ts").layer, "tooling");
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

/**
 * Service detection.
 *
 * The rows of the map, found rather than declared. The two rules that keep it
 * honest on a real repository are both asserted here: a manifest inside excluded
 * output is not a service, and a manifest directory with no code under it is an
 * umbrella rather than a service.
 */
test("a manifest directory with code under it becomes a service", () => {
  const services = detectServices({
    dir: FIXTURE_DIR,
    all: ["flat-app/package.json", "flat-app/src/server.ts"],
    paths: ["flat-app/src/server.ts"],
    exclude: [],
  });
  assert.equal(services.length, 1);
  assert.equal(services[0].id, "flat-app");
  // A manifest at the scanned root owns everything, which is what rootless means.
  assert.equal(services[0].root, "flat-app");
});

test("a vendored manifest inside excluded output is not a service", () => {
  const services = detectServices({
    dir: FIXTURE_DIR,
    all: ["flat-app/package.json", "flat-app/node_modules/left-pad/package.json", "flat-app/src/server.ts"],
    paths: ["flat-app/src/server.ts"],
    exclude: DEFAULT_EXCLUDE,
  });
  assert.deepEqual(services.map((s) => s.id), ["flat-app"]);
});

test("a manifest with no files under it is an umbrella, not a service", () => {
  const services = detectServices({
    dir: FIXTURE_DIR,
    all: ["package.json", "flat-app/package.json", "flat-app/src/server.ts"],
    paths: ["flat-app/src/server.ts"],
    exclude: [],
  });
  // The root manifest lists the others and owns no code of its own.
  assert.deepEqual(services.map((s) => s.id), ["flat-app"]);
});

test("a repo with no manifest anywhere still gets a service", () => {
  const detected = detectServices({ dir: FIXTURE_DIR, all: ["a.ts"], paths: ["a.ts"], exclude: [] });
  assert.equal(detected, null, "nothing to detect");
  // ...and the defaults cover it, which is what keeps serviceOf total.
  const { services, serviceOf } = loadConfig();
  assert.equal(services.length, 1);
  assert.ok(services.some((s) => s.id === serviceOf("a.ts").service));
});

/**
 * The payload-level totality guarantee. A config's own serviceOf may return an
 * id it never declared — the prototype's did, and every file it touched vanished
 * from the view. The id gets declared rather than the files getting moved.
 */
test("a service used but never declared is added rather than dropped", () => {
  const declared = [{ id: "api", root: "api" }];
  const nodes = [{ service: "api" }, { service: "ghost" }, { service: "ghost" }];
  const out = reconcileServices(declared, nodes);
  assert.deepEqual(out.map((s) => s.id), ["api", "ghost"]);
  assert.equal(out[1].synthesized, true, "a reader must be able to tell which rows the tool added");
  for (const n of nodes) assert.ok(out.some((s) => s.id === n.service));
});

test("reconciliation leaves a consistent payload untouched", () => {
  const declared = [{ id: "api", root: "api" }];
  const out = reconcileServices(declared, [{ service: "api" }]);
  assert.equal(out, declared, "no copy, no synthesized rows, nothing to say");
});

/**
 * `suiteConfigs` names a runner config whose include/exclude globs decide which
 * files count as which kind of test, so the glob translation is config surface.
 * The globstar case is the one worth pinning: a single-star expansion that ate
 * `**` would silently stop matching any nested test file.
 */
test("a glob translates to a regexp, and the globstar survives the single-star pass", () => {
  const cases = [
    ["**/*.test.ts", ["a.test.ts", "src/deep/a.test.ts"], ["a.ts", "a.test.tsx"]],
    ["src/**/*.ts", ["src/a.ts", "src/x/y/a.ts"], ["lib/a.ts"]],
    ["*.py", ["a.py"], ["pkg/a.py"]],
    ["test/**/test_*.py", ["test/test_a.py", "test/x/test_a.py"], ["test/a.py"]],
  ];
  for (const [glob, hits, misses] of cases) {
    const re = globToRe(glob);
    for (const h of hits) assert.ok(re.test(h), `${glob} should match ${h}`);
    for (const m of misses) assert.ok(!re.test(m), `${glob} should not match ${m}`);
  }
});
