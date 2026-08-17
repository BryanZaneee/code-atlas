/**
 * Layout and projection maths.
 *
 * The viewer's first five modules are pure: they touch the DOM only inside
 * functions the layout path never calls, so they can be run in a vm against a
 * synthetic payload with no browser at all. That is enough to cover the two
 * things that actually break — the argument-spread crash and the height curve.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VIEWER_DIR } from "../src/build/assemble.mjs";

const LAYOUT_MODULES = ["00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js", "40-packets.js"];

/**
 * Run the layout half of the viewer over a payload and hand back its scope.
 * `let`/`const` are lexical, so they never appear on the context object — the
 * bindings under test have to be handed out explicitly.
 */
function runLayout(atlas) {
  const source =
    LAYOUT_MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("") +
    // declared in 50-render.js, which needs a canvas and is not loaded here
    "\nvar staticDirty = false;\nrelayout();\n" +
    "\nglobalThis.scope = { LAYOUT, project, heightOf, S, visibleSet, LOC_P95 };\n";
  const ctx = vm.createContext({ ATLAS: atlas, console });
  vm.runInContext(`"use strict";\n${source}`, ctx, { timeout: 60_000 });
  return ctx.scope;
}

/** A payload of `n` nodes spread over services and layers, with real edges. */
function synthetic(n, edgeCount) {
  const services = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, lang: "ts", root: `s${i}`, order: i }));
  const layers = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, label: `L${i}`, rank: i, color: "#8fae74" }));
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `s${i % 6}/f${i}.ts`,
    name: `f${i}.ts`,
    dir: `s${i % 6}`,
    service: `s${i % 6}`,
    layer: `l${i % 8}`,
    lang: "ts",
    loc: 1 + (i * 37) % 4000,
    kind: "file",
    exports: 0,
    externals: [],
    testKind: null,
    subject: null,
    inDeg: 0,
    outDeg: 0,
    coverage: "direct",
    uncovered: false,
  }));
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    from: nodes[i % n].id,
    to: nodes[(i * 7 + 3) % n].id,
    kind: "import",
    cross: false,
  }));
  const groups = [];
  return {
    meta: { schemaVersion: 1, repo: "synthetic", nodeCount: n },
    services, layers, nodes, edges, endpoints: [], flows: [], groups,
  };
}

/**
 * The documented crash: Math.min(...pts.map()) passes one argument per point,
 * eight per node, and dies around 8k nodes. 5,000 nodes is well past the point
 * where the old code was already at risk and is the roadmap's stated gate.
 */
test("a 5,000-node / 12,000-edge payload lays out without a RangeError", () => {
  const scope = runLayout(synthetic(5000, 12000));
  const layout = scope.LAYOUT;
  assert.equal(layout.nodes.length, 5000);
  for (const k of ["x0", "x1", "y0", "y1"]) {
    assert.ok(Number.isFinite(layout.bbox[k]), `bbox.${k} is ${layout.bbox[k]}`);
  }
  assert.ok(layout.bbox.x1 > layout.bbox.x0);
  assert.ok(layout.bbox.y1 > layout.bbox.y0);
});

test("the bbox encloses every drawn face", () => {
  const scope = runLayout(synthetic(400, 600));
  const { bbox, nodes } = scope.LAYOUT;
  for (const n of nodes) {
    for (const p of [...n.faceTop, ...n.faceLeft]) {
      assert.ok(p.x >= bbox.x0 && p.x <= bbox.x1, `x ${p.x} outside [${bbox.x0}, ${bbox.x1}]`);
      assert.ok(p.y >= bbox.y0 && p.y <= bbox.y1, `y ${p.y} outside [${bbox.y0}, ${bbox.y1}]`);
    }
  }
});

test("the projection is unchanged from the prototype", () => {
  const scope = runLayout(synthetic(8, 4));
  // Objects cross a vm realm boundary, so compare components, not identity.
  const at = (gx, gy, h) => { const p = scope.project(gx, gy, h); return [p.x, p.y]; };
  assert.deepEqual(at(1, 0, 0), [32, 16]);
  assert.deepEqual(at(0, 0, 0), [0, 0]);
  assert.deepEqual(at(0, 1, 0), [-32, 16]);
  assert.deepEqual(at(2, 2, 10), [0, 54]);
});

/**
 * The 5,000-node gate above is the roadmap's, but it does not by itself prove
 * the spread is gone: this Node build tolerates ~125k arguments, which is about
 * 15k nodes at eight points each. 20,000 nodes is past that on any engine, so
 * this is the size at which the old implementation is guaranteed to throw.
 */
test("bbox does not spread arguments, at a size that would have thrown", () => {
  const scope = runLayout(synthetic(20000, 4000));
  assert.equal(scope.LAYOUT.nodes.length, 20000);
  assert.ok(Number.isFinite(scope.LAYOUT.bbox.x1));
});

/**
 * The old curve was 8 + min(sqrt(loc) * 4.2, 130), which pinned everything past
 * ~958 lines to the same height. Distinguishing large files from very large
 * files is most of why heights exist.
 */
test("height keeps rising past the point the old curve saturated", () => {
  const scope = runLayout(synthetic(600, 100));
  const h = (loc) => scope.heightOf({ kind: "file", loc });
  assert.ok(h(5000) > h(1000), `${h(5000)} should exceed ${h(1000)}`);
  assert.ok(h(1000) > h(200), `${h(1000)} should exceed ${h(200)}`);
  assert.ok(h(1) > 8);
});

test("height is bounded so one giant file cannot flatten the map", () => {
  const scope = runLayout(synthetic(600, 100));
  assert.ok(scope.heightOf({ kind: "file", loc: 5_000_000 }) <= 268);
});

test("depth order is non-decreasing along the view axis", () => {
  const scope = runLayout(synthetic(300, 200));
  const keys = scope.LAYOUT.nodes.map((n) => n.gx + n.gy);
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i] >= keys[i - 1], `depth order inverted at ${i}`);
  }
});

test("no two visible nodes occupy the same cell", () => {
  const scope = runLayout(synthetic(1200, 500));
  const cells = scope.LAYOUT.nodes.map((n) => `${n.gx}|${n.gy}`);
  assert.equal(new Set(cells).size, cells.length);
});
