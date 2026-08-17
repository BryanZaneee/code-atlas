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
import { serialize, scanFixture } from "./helpers.mjs";
import { SCHEMA_VERSION } from "../src/build/build.mjs";

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

test("groups partition the node set exactly", async () => {
  const p = await payloadOf();
  const members = p.groups.flatMap((g) => g.members);
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
