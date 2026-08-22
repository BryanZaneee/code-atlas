/**
 * Payload invariants.
 *
 * The payload is a public contract, so these are the properties anything
 * written against --json may rely on. They hold for every target, which is why
 * they run against a fixture here and against the real corpus in
 * targets.test.mjs.
 *
 * Determinism is the load-bearing one: it is what makes the golden diffs, and
 * every later regression check, mean anything at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { serialize, scanFixture, FIXTURE_DIR } from "./helpers.mjs";
import { SCHEMA_VERSION } from "../src/build/build.mjs";
import { buildViews, buildTheme, rampColors, paintLayers } from "../src/model/chrome.mjs";

const payloadOf = async () => (await scanFixture("mini-monorepo")).payload;

test("two runs of the same input are byte-identical", async () => {
  const [a, b] = [await payloadOf(), await payloadOf()];
  assert.equal(serialize(a), serialize(b));
});

test("generatedAt is the only field allowed to vary", async () => {
  const [a, b] = [await payloadOf(), await payloadOf()];
  // Same input, so even generatedAt usually matches; what must never happen is
  // any OTHER field differing. Normalising only generatedAt and demanding
  // equality is exactly that assertion.
  assert.equal(serialize(a), serialize(b));
  assert.match(a.meta.generatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
});

test("meta carries a schema version and an acquisition mode", async () => {
  const p = await payloadOf();
  assert.equal(p.meta.schemaVersion, SCHEMA_VERSION);
  assert.ok(["worktree", "ref", "fs"].includes(p.meta.acquisition.mode));
});

/**
 * The counters the chrome states permanently. They are only worth putting in
 * the frame if they are recomputable from the payload beside them — a number
 * nobody can check is decoration.
 */
test("meta's coverage counters agree with the payload", async () => {
  const p = await payloadOf();
  assert.ok(p.meta.unsortedCount <= p.meta.fileCount);
  // Not "layer === unsorted": an unmatched file can still be placed by the
  // directory-derived fallback. What the counter reports is that no rule
  // matched, which is exactly what the provenance string says.
  assert.equal(p.meta.unsortedCount, p.nodes.filter((n) => n.layerWhy?.startsWith("no rule matched")).length);

  const observed = new Set(p.edges.filter((e) => e.kind === "import").map((e) => `${e.from}|${e.to}`));
  const derived = p.flows.reduce(
    (a, f) => a + f.steps.filter((s) => !observed.has(`${s.from}|${s.to}`)).length,
    0,
  );
  assert.equal(p.meta.derivedCount, derived);
});

/**
 * A code that moves between scans is worse than no code: the map's labels would
 * be a different set of names every time a file was added.
 */
test("district codes are unique and survive a new file", async () => {
  const p = await payloadOf();
  const codes = p.districts.map((g) => g.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every((c) => /^[A-Z][A-Z0-9]$/.test(c)), codes.join(", "));
  assert.ok(p.districts.every((g) => g.parentId === g.service));

  // Dropping the first district's members simulates the file churn that
  // first-appearance ordering would have reshuffled the whole set on.
  const { buildDistricts } = await import("../src/model/graph.mjs");
  const survivors = p.districts.slice(1).flatMap((g) => g.members);
  const kept = p.nodes.filter((n) => survivors.includes(n.id));
  const after = new Map(buildDistricts(kept, p.layers).map((g) => [g.id, g.code]));
  for (const g of p.districts.slice(1)) assert.equal(after.get(g.id), g.code, `${g.id} was renamed`);
});

test("travelledBy indexes the flows and is absent when empty", async () => {
  const p = await payloadOf();
  for (const n of p.nodes) {
    const expected = p.flows.filter((f) => f.steps.some((s) => s.from === n.id || s.to === n.id)).map((f) => f.id);
    if (!expected.length) assert.equal("travelledBy" in n, false, `${n.id} carries an empty index`);
    else assert.deepEqual(n.travelledBy, expected.sort());
  }
});

test("a payload with endpoints offers a request view", async () => {
  const p = await payloadOf();
  assert.ok(p.endpoints.length > 0, "fixture must have endpoints for this to mean anything");
  const v = p.views.find((v) => v.kind === "request");
  assert.ok(v, "an endpoint surface gets a view to compose a request against");
  assert.equal(v.id, "request");
});

test("a repo with no endpoints gets no request view", () => {
  const views = buildViews({}, [], [], []);
  assert.equal(views.some((v) => v.kind === "request"), false);
});

/**
 * Four buttons, not seven. Data flow rides in the structure map as import
 * packets and inferred paths are reached through the composer, so the strip
 * names the four things a reader actually picks between.
 */
test("the strip offers four views, and structure is the one that carries the traffic", () => {
  const views = buildViews({}, [], [], [{ id: "GET /x" }]);
  assert.deepEqual(views.map((v) => v.id), ["structure", "tests", "request", "findings"]);
  assert.equal(views.find((v) => v.id === "structure").kind, "dataflow",
    "the city and the packets on it are one view, not two");
  assert.equal(views.some((v) => v.id === "derived"), false,
    "derived paths lost their own button when the composer took them");
});

/**
 * A repo with no HTTP surface can still have inferred paths worth playing, so
 * the composer appears for either reason — and for neither it stays away.
 */
test("derived paths alone are enough to earn the composer", () => {
  assert.ok(buildViews({}, [], [{ id: "d" }], []).some((v) => v.kind === "request"));
  assert.equal(buildViews({}, [], [], []).some((v) => v.kind === "request"), false);
});

/**
 * The golden files pin every colour in the ramp, so the generator has to be a
 * pure function of the length asked for — not of insertion order, a Map, or
 * anything else that could reorder between runs.
 */
test("the identity ramp is deterministic in its length", () => {
  assert.deepEqual(rampColors("atlas", 12), rampColors("atlas", 12));
  assert.equal(rampColors("atlas", 12).length, 12);
  assert.equal(new Set(rampColors("atlas", 12)).size, 12, "twelve steps, twelve colours");
  // Okabe-Ito is a fixed set chosen for colour-vision deficiency; it repeats
  // rather than interpolating, which is the point of shipping it.
  assert.equal(rampColors("okabe", 10)[8], rampColors("okabe", 10)[0]);
});

test("layers are painted from the ramp, and a config's own colour survives", () => {
  const painted = paintLayers([{ id: "a" }, { id: "b", color: "#123456" }]);
  assert.equal(painted[1].color, "#123456", "a colour the config named is not overwritten");
  assert.match(painted[0].color, /^#[0-9a-f]{6}$/, "a layer with no colour gets one");
  assert.equal(painted[0].color, rampColors("atlas", 8)[0], "and it comes from the ramp, by position");
});

/**
 * Canvas cannot read a CSS custom property, so the payload is the only place a
 * colour can be defined. The viewer's PALETTE panel indexes these.
 */
test("the theme ships every ramp, sized to the layer list", () => {
  const theme = buildTheme({}, 18);
  assert.deepEqual(Object.keys(theme.ramps).sort(), ["atlas", "blueprint", "earth", "okabe"]);
  assert.equal(theme.ramps.atlas.length, 18);
  // Floored, so a tiny repo still has a ramp wide enough to colour by language.
  assert.equal(buildTheme({}, 3).ramps.atlas.length, 8);
});

test("node ids are unique", async () => {
  const p = await payloadOf();
  const ids = p.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every edge endpoint resolves to a node", async () => {
  const p = await payloadOf();
  const ids = new Set(p.nodes.map((n) => n.id));
  const dangling = p.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
  assert.deepEqual(dangling, []);
});

/**
 * The field jump-to-line opens on: a 1-based line in `from`, within the
 * file, that actually names the import. Only `kind: "import"` carries it —
 * `test:subject`/`test:exercises` edges are drawn from the same internal-import
 * set but are not what jump-to-line means to open.
 */
test("import edges carry a plausible line", async () => {
  const p = await payloadOf();
  const importEdges = p.edges.filter((e) => e.kind === "import");
  assert.ok(importEdges.length > 0, "no import edges to check");

  for (const e of importEdges) {
    assert.ok(Number.isInteger(e.line) && e.line >= 1, `${e.from} -> ${e.to} has line ${e.line}`);
    const text = readFileSync(path.join(FIXTURE_DIR, "mini-monorepo", e.from), "utf8");
    const lineCount = text.length ? text.replace(/\n$/, "").split("\n").length : 0;
    assert.ok(e.line <= lineCount, `${e.from} -> ${e.to}: line ${e.line} exceeds ${lineCount} lines`);
  }

  // routes/users.ts names the service module on its second line — a concrete
  // check that `line` points at the statement that actually produced the edge.
  const edge = importEdges.find(
    (e) => e.from === "services/api/src/routes/users.ts" && e.to === "services/api/src/services/user-service.ts",
  );
  assert.ok(edge, "expected routes/users.ts -> services/user-service.ts import edge");
  assert.equal(edge.line, 2);
  const text = readFileSync(path.join(FIXTURE_DIR, "mini-monorepo", edge.from), "utf8");
  assert.match(text.split("\n")[edge.line - 1], /user-service/);

  // No other edge kind invents a line.
  for (const e of p.edges) {
    if (e.kind !== "import") assert.equal("line" in e, false, `${e.kind} edge ${e.from}->${e.to} carries a line`);
  }
});

/**
 * The blank-screen failure. serviceOf returning a service that is not in the
 * services list filters every node out of the view, and there is no checkbox to
 * recover it. Phase 2 makes serviceOf total; this asserts the property that
 * makes it a rendering guarantee rather than a hope.
 */
test("every node's service exists in services", async () => {
  const p = await payloadOf();
  const known = new Set(p.services.map((s) => s.id));
  const orphans = [...new Set(p.nodes.filter((n) => !known.has(n.service)).map((n) => n.service))];
  assert.deepEqual(orphans, []);
});

test("every node's layer exists in layers", async () => {
  const p = await payloadOf();
  const known = new Set(p.layers.map((l) => l.id));
  const orphans = [...new Set(p.nodes.filter((n) => !known.has(n.layer)).map((n) => n.layer))];
  assert.deepEqual(orphans, []);
});

test("districts partition the node set exactly", async () => {
  const p = await payloadOf();
  const members = p.districts.flatMap((g) => g.members);
  assert.equal(members.length, p.nodes.length);
  assert.deepEqual(new Set(members).size, p.nodes.length);
});

test("meta counts agree with the arrays they summarise", async () => {
  const p = await payloadOf();
  assert.equal(p.meta.nodeCount, p.nodes.length);
  assert.equal(p.meta.edgeCount, p.edges.length);
  assert.equal(p.meta.endpointCount, p.endpoints.length);
  assert.equal(p.meta.testCount, p.nodes.filter((n) => n.layer === "test").length);
});

test("coverage is one of the three states, or absent", async () => {
  const p = await payloadOf();
  for (const n of p.nodes) {
    assert.ok(
      [undefined, null, "direct", "indirect", "none"].includes(n.coverage),
      `${n.id} has coverage ${JSON.stringify(n.coverage)}`,
    );
  }
});

test("an endpoint's path carries its mount prefix", async () => {
  const p = await payloadOf();
  const ids = p.endpoints.map((e) => e.id);
  // router.* rules mount under /api; @app.* rules mount at the root.
  assert.ok(ids.includes("GET /api/users"), ids.join(" | "));
  assert.ok(ids.includes("GET /health"), ids.join(" | "));
});

/**
 * Graceful degradation — the properties that must hold with no config at all.
 *
 * PLAN.md's failure modes #1, #2 and #4 all end the same way: a repository the
 * tool has never seen renders as a blank screen, an all-orange map, or a single
 * column. `fixtures/flat-app` is a flat single package with no config and no
 * tests, so CI enforces these without needing the validation corpus.
 */
const flatOf = async () => (await scanFixture("flat-app")).payload;

test("a repo with no config still produces a legible atlas", async () => {
  const p = await flatOf();
  assert.ok(p.meta.nodeCount > 0, "no nodes at all");
  assert.ok(p.services.length >= 1, "no services to switch on");
  assert.ok(p.layers.length >= 1);
  assert.ok(p.nodes.some((n) => n.kind === "file" && n.lang !== "md"), "no code nodes");
});

/**
 * Failure mode #1: serviceOf returned an id that was not in the services list,
 * the viewer filters by service, and every node vanished — with no checkbox left
 * to bring it back.
 */
test("with no config, every node's service is still one you can switch off", async () => {
  const p = await flatOf();
  const known = new Set(p.services.map((s) => s.id));
  assert.deepEqual([...new Set(p.nodes.map((n) => n.service).filter((s) => !known.has(s)))], []);
});

/** Failure mode #4: nothing matched, so everything landed in one column. */
test("with no config, files are spread across more than one layer", async () => {
  const p = await flatOf();
  const layers = new Set(p.nodes.filter((n) => n.kind === "file").map((n) => n.layer));
  assert.ok(layers.size > 1, `every file landed in ${[...layers]}`);
});

/**
 * Failure mode #2: no tests meant every file read "none", which is the value
 * that means UNTESTED. Absent evidence is not evidence of absence.
 */
test("a repo with no tests reports coverage as not measured, not as untested", async () => {
  const p = await flatOf();
  assert.equal(p.meta.testCount, 0);
  assert.equal(p.meta.suiteCount, 0);
  // Non-file nodes carry no coverage key at all, which the schema documents.
  assert.deepEqual([...new Set(p.nodes.filter((n) => n.kind === "file").map((n) => n.coverage))], [null]);
  assert.equal(p.meta.coverNone, 0, "0 files may be reported as untested here");
});

test("classification provenance is present on every file node", async () => {
  const p = await flatOf();
  for (const n of p.nodes.filter((x) => x.kind === "file")) {
    assert.ok(n.layerWhy, `${n.id} has no reason for its layer`);
    assert.ok(n.serviceWhy, `${n.id} has no reason for its service`);
  }
});

test("endpoint nodes carry the same serviceWhy/layerWhy shape file nodes do, plus which rule placed them", async () => {
  const p = await payloadOf();
  const endpointNodes = p.nodes.filter((n) => n.kind === "endpoint");
  assert.ok(endpointNodes.length > 0, "expected at least one endpoint node");
  for (const n of endpointNodes) {
    assert.ok(n.layerWhy, `${n.id} has no reason for its layer`);
    assert.ok(n.serviceWhy, `${n.id} has no reason for its service`);
    assert.ok(n.why, `${n.id} has no reason for its registration rule`);
  }
});

test("datastore nodes are provenanced as declared in config", async () => {
  const { buildNodes } = await import("../src/model/graph.mjs");
  const ctx = {
    paths: [],
    src: new Map(),
    config: {
      layerOf: () => ({ layer: "unsorted", why: "no rule matched", matched: false }),
      serviceOf: () => ({ service: "app", why: "fell back" }),
      datastores: [{ id: "db:main", label: "MAIN DB" }],
    },
  };
  const { nodes } = buildNodes(ctx, { imports: new Map(), endpoints: [], testKind: () => null, subjectOf: () => null });
  const store = nodes.find((n) => n.kind === "datastore");
  assert.equal(store.layerWhy, "declared as a datastore in the config");
  assert.equal(store.serviceWhy, "datastores are grouped under the infra service");
});
