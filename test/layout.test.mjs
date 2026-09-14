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
import { DEFAULT_THEME, buildViews } from "../src/model/chrome.mjs";

// 60-pick.js is loaded for `inPoly`: the two tests below assert that the faces
// drawn are the faces hit testing uses, which is only true if they call the
// SHIPPED predicate. They each carried a local copy, so a regression in
// 60-pick.js would have left both of them passing.
const LAYOUT_MODULES = ["00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js", "40-packets.js", "60-pick.js", "75-findings.js"];

/**
 * Run the layout half of the viewer over a payload and hand back its scope.
 * `let`/`const` are lexical, so they never appear on the context object — the
 * bindings under test have to be handed out explicitly.
 */
function runLayout(atlas) {
  const source =
    LAYOUT_MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("") +
    // declared in 50-render.js, which needs a canvas and is not loaded here
    "\nvar staticDirty = false;\nsetYaw(S.yaw);\nrelayout();\n" +
    "\nglobalThis.scope = { LAYOUT, project, heightOf, S, visibleSet, LOC_P95, setYaw, reproject, relayout, depthOf, YAW0, SHAPE_IDS, SHAPES, inPoly };\n";
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
    meta: { schemaVersion: 1, repo: "synthetic", nodeCount: n, suiteCount: 0 },
    services, layers, nodes, edges, endpoints: [], flows: [], groups,
    views: buildViews({}, []),
    theme: DEFAULT_THEME,
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
    for (const p of n.faces.flatMap((f) => f.pts)) {
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

/* ──────────────────────── camera rotation ──────────────────────── */

/**
 * The default view must not move when rotation ships. Deriving the basis as a
 * rotation away from 45° rather than from zero is what makes this exact: the
 * algebraically identical cos(yaw)/sin(yaw) form is off by an ulp, which is
 * enough to shift every cached polygon.
 */
test("yaw 45 degrees is bit-identical to the fixed projection", () => {
  const scope = runLayout(synthetic(60, 20));
  scope.setYaw(scope.YAW0);
  for (const [gx, gy, h] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [3, 7, 42], [-2, 5, 9]]) {
    const p = scope.project(gx, gy, h);
    assert.equal(p.x, (gx - gy) * 32, `x at ${gx},${gy}`);
    assert.equal(p.y, (gx + gy) * 16 - h, `y at ${gx},${gy}`);
  }
});

/**
 * The painter's algorithm only works if the sort key really is depth. Sweeping
 * the full circle catches the quadrants an assumption baked in at 45° would
 * silently break — the far box must never be painted after the near one.
 */
test("a 360 degree sweep never mis-occludes", () => {
  const scope = runLayout(synthetic(500, 200));
  for (let deg = 0; deg < 360; deg += 5) {
    scope.setYaw((deg * Math.PI) / 180);
    scope.reproject();
    const nodes = scope.LAYOUT.nodes;
    for (let i = 1; i < nodes.length; i++) {
      const prev = scope.depthOf(nodes[i - 1].gx, nodes[i - 1].gy);
      const cur = scope.depthOf(nodes[i].gx, nodes[i].gy);
      assert.ok(cur >= prev - 1e-9, `depth inverted at ${deg}deg, index ${i}`);
    }
  }
});

test("every yaw produces a finite bounding box and full face set", () => {
  const scope = runLayout(synthetic(300, 120));
  for (let deg = 0; deg < 360; deg += 15) {
    scope.setYaw((deg * Math.PI) / 180);
    scope.reproject();
    const { bbox, nodes } = scope.LAYOUT;
    for (const k of ["x0", "x1", "y0", "y1"]) {
      assert.ok(Number.isFinite(bbox[k]), `bbox.${k} at ${deg}deg`);
    }
    for (const n of nodes) {
      // At least one cap and one wall, whatever the shape: a block with no
      // camera-facing wall is a block drawn inside out.
      assert.ok(n.faces.some((f) => f.cap), `no cap at ${deg}deg`);
      assert.ok(n.faces.some((f) => !f.cap), `no visible wall at ${deg}deg`);
      for (const f of n.faces) assert.ok(f.pts.length >= 3, `degenerate face at ${deg}deg`);
    }
  }
});

/**
 * The visible vertical faces change quadrant as the camera comes round, so the
 * plane each side face sits on has to be chosen per axis rather than assumed.
 * A face drawn on the far plane renders the silhouette inside out.
 *
 * The check: a visible face's ground edge must be NEARER the camera than the
 * cell's own centre — strictly greater screen y. Pinning either plane to a
 * constant fails this over half the circle.
 */
test("the drawn side faces are the ones facing the camera", () => {
  const scope = runLayout(synthetic(40, 10));
  // A wall's ground edge is its last two points, whatever the footprint.
  const midY = (face) => (face.pts[2].y + face.pts[3].y) / 2;
  for (let deg = 0; deg < 360; deg += 10) {
    scope.setYaw((deg * Math.PI) / 180);
    scope.reproject();
    for (const n of scope.LAYOUT.nodes) {
      const centre = scope.project(n.gx + 0.5, n.gy + 0.5, 0).y;
      const walls = n.faces.filter((f) => !f.cap);
      assert.ok(walls.length, `no wall drawn at ${deg}deg`);
      for (const w of walls) {
        assert.ok(midY(w) > centre - 1e-9, `a wall was drawn on the far plane at ${deg}deg`);
      }
    }
  }
});

/**
 * Hit testing inverse-transforms to world space and ray-casts the cached
 * polygons, so it should need no rotation-specific code at all. This asserts
 * that: the centre of a box's roof must land inside that roof at every angle.
 */
test("a roof centre stays inside its own polygon at every yaw", () => {
  const scope = runLayout(synthetic(120, 40));
  for (let deg = 0; deg < 360; deg += 15) {
    scope.setYaw((deg * Math.PI) / 180);
    scope.reproject();
    for (const n of scope.LAYOUT.nodes) {
      const cap = n.faces.filter((f) => f.cap).at(-1);
      assert.ok(scope.inPoly(n.top.x, n.top.y, cap.pts), `roof centre outside its roof at ${deg}deg`);
    }
  }
});

/**
 * Every shape draws the same polygons the picker tests.
 *
 * These were three named fields — faceTop/Left/Right — read independently by
 * the renderer, the selection hull and hit testing. The moment a shape is drawn
 * from anything other than the faces the picker casts against, the map becomes
 * a lie you can click on: the thing under the cursor and the thing that answers
 * are different nodes. One face list, read by all three.
 */
test("every shape's drawn faces are the faces hit testing uses", () => {
  const scope = runLayout(synthetic(120, 40));
  for (const shape of scope.SHAPE_IDS) {
    scope.S.shape = shape;
    for (const deg of [0, 45, 100, 215]) {
      scope.setYaw((deg * Math.PI) / 180);
      scope.reproject();
      for (const n of scope.LAYOUT.nodes) {
        assert.ok(n.faces.length, `${shape}: no faces at ${deg}deg`);
        assert.ok(n.faces.some((f) => f.cap), `${shape}: no cap at ${deg}deg`);
        // The LAST cap is the roof: a stepped block caps every tier, and the
        // label anchor belongs on the top one.
        const roof = n.faces.filter((f) => f.cap).at(-1);
        assert.ok(scope.inPoly(n.top.x, n.top.y, roof.pts), `${shape}: roof anchor off its roof at ${deg}deg`);
        for (const f of n.faces) assert.ok(f.pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
          `${shape}: non-finite point at ${deg}deg`);
      }
    }
  }
  scope.S.shape = "block";
});

test("rotating does not move anything in world space", () => {
  const scope = runLayout(synthetic(200, 80));
  const before = scope.LAYOUT.nodes.map((n) => `${n.id}@${n.gx},${n.gy},${n.h}`).sort();
  const districts = scope.LAYOUT.districts.map((d) => `${d.id}:${d.x0},${d.y0},${d.x1},${d.y1}`).sort();
  scope.setYaw(1.1);
  scope.reproject();
  assert.deepEqual(scope.LAYOUT.nodes.map((n) => `${n.id}@${n.gx},${n.gy},${n.h}`).sort(), before);
  assert.deepEqual(scope.LAYOUT.districts.map((d) => `${d.id}:${d.x0},${d.y0},${d.x1},${d.y1}`).sort(), districts);
});
