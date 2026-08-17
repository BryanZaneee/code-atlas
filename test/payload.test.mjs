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
