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
 *
 * LAYOUT is handed out as a GETTER, not a value: `relayout()` reassigns it, so
 * a plain copy would go stale the moment anything re-laid out and a test would
 * be asserting against the previous map.
 */
function runLayout(atlas) {
  const source =
    LAYOUT_MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("") +
    // declared in 50-render.js, which needs a canvas and is not loaded here
    "\nvar staticDirty = false;\nsetYaw(S.yaw);\nrelayout();\n" +
    "\nglobalThis.scope = { get LAYOUT() { return LAYOUT; }, project, heightOf, S, visibleSet, LOC_P95, setYaw, reproject, relayout, depthOf, YAW0, SHAPE_IDS, SHAPES, shapeIdFor, inPoly, groupKeyOf, keyCompare, labelForKey, DENSITY_IDS, setDensity, SPACING_MIN, spacingNow: () => SPACING, moveDistrict, resetOffsets, districtOffset, districtWouldOverlap, pickDistrict, project, toScreen, unproject, epochNow: () => layoutEpoch };\n";
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
  const districts = [];
  return {
    meta: { schemaVersion: 2, repo: "synthetic", nodeCount: n, suiteCount: 0 },
    services, layers, nodes, edges, endpoints: [], flows: [], districts,
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
      const shape = scope.SHAPES[scope.shapeIdFor(n)];
      const h = n.h * shape.hs;
      const base = n.pz ?? 0;
      // Faces come out prism by prism, each run of walls closed by its own cap,
      // so counting caps says which prism a wall belongs to — and that is what
      // gives its base height. Comparing every wall against the floor instead
      // would read a stepped block's upper storeys as inside out, because their
      // ground edges legitimately sit above it.
      let prism = 0, walls = 0;
      for (const f of n.faces) {
        if (f.cap) { prism++; continue; }
        walls++;
        const z0 = base + h * shape.prisms[prism].z0;
        const centre = scope.project(n.gx + 0.5, n.gy + 0.5, z0).y;
        assert.ok(midY(f) > centre - 1e-9,
          `a wall was drawn on the far plane at ${deg}deg (${scope.shapeIdFor(n)}, storey ${prism})`);
      }
      assert.ok(walls, `no wall drawn at ${deg}deg`);
      assert.equal(prism, shape.prisms.length, "every prism caps itself exactly once");
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

/**
 * Density is a preference; the depth sort is not.
 *
 * A block's footprint is one cell, so a spacing at or below 1 lets footprints
 * overlap, at which point painter's order and hit testing disagree and the map
 * can be clicked on and lie. `setDensity` clamps rather than validates, which
 * this pins from both directions: every shipped preset clears the floor, and a
 * config that asks for something illegal is corrected instead of obeyed.
 */
test("every density preset stays above the depth-sort floor", () => {
  const scope = runLayout(synthetic(300, 400));
  assert.ok(scope.DENSITY_IDS.length >= 2, "a control with one option is not a control");
  for (const id of scope.DENSITY_IDS) {
    scope.setDensity(id);
    assert.ok(scope.spacingNow() > 1, `${id} packs blocks at ${scope.spacingNow()}, at or under one cell`);
    assert.ok(scope.spacingNow() >= scope.SPACING_MIN, `${id} is under the floor`);
  }
});

test("a config asking for an illegal spacing is clamped, not obeyed", () => {
  const atlas = synthetic(60, 40);
  atlas.theme = { ...atlas.theme, density: { ...atlas.theme.density, presets: { ...atlas.theme.density.presets, silly: { spacing: 0.2, gutLayer: -5, gutSvc: 0 } } } };
  const scope = runLayout(atlas);
  scope.setDensity("silly");
  assert.equal(scope.spacingNow(), scope.SPACING_MIN);
});

/**
 * The point of the control: compact has to actually be smaller. Measured on the
 * bbox rather than the constants, because that is what a reader sees.
 */
test("compact draws a strictly smaller map than normal, and normal than roomy", () => {
  const area = (density) => {
    const atlas = synthetic(300, 400);
    atlas.theme = { ...atlas.theme, density: { ...atlas.theme.density, default: density } };
    const { bbox } = runLayout(atlas).LAYOUT;
    return (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0);
  };
  const compact = area("compact"), normal = area("normal"), roomy = area("roomy");
  assert.ok(compact < normal, `compact ${compact} is not under normal ${normal}`);
  assert.ok(normal < roomy, `normal ${normal} is not under roomy ${roomy}`);
});

/** The default a fresh atlas opens at, so a retune cannot silently undo itself. */
test("the shipped default is not the old roomy spacing", () => {
  const scope = runLayout(synthetic(60, 40));
  assert.equal(scope.S.density, "normal");
  assert.ok(scope.spacingNow() < 1.5, "the default is still drawn at the pre-2.7 pitch");
});

/**
 * Dragging a district.
 *
 * The map is allowed to be rearranged; the depth sort is not allowed to stop
 * being exact while it happens. Offsets are whole cells for that reason, so
 * these assert the lattice as much as the movement.
 */
test("an offset moves exactly its own district, by whole cells", () => {
  const scope = runLayout(synthetic(300, 400));
  const target = scope.LAYOUT.districts[0].id;
  const before = new Map(scope.LAYOUT.nodes.map((n) => [n.id, { gx: n.gx, gy: n.gy }]));
  const inside = new Set(scope.LAYOUT.districts.find((d) => d.id === target).blocks.map((n) => n.id));

  assert.equal(scope.moveDistrict(target, { dx: 40, dy: 30 }), true);

  const pitch = scope.spacingNow();
  for (const n of scope.LAYOUT.nodes) {
    const was = before.get(n.id);
    const dx = n.gx - was.gx, dy = n.gy - was.gy;
    if (!inside.has(n.id)) {
      assert.equal(dx, 0, `${n.id} moved and is not in the dragged district`);
      assert.equal(dy, 0, `${n.id} moved and is not in the dragged district`);
      continue;
    }
    // Every block in the district moves by the same whole number of cells:
    // the district keeps its internal packing, and lands back on the lattice.
    assert.ok(Math.abs(dx - 40 * pitch) < 1e-9, `${n.id} moved ${dx}, not ${40 * pitch}`);
    assert.ok(Math.abs(dy - 30 * pitch) < 1e-9, `${n.id} moved ${dy}, not ${30 * pitch}`);
  }
});

test("the district's plate and its blocks move together", () => {
  const scope = runLayout(synthetic(300, 400));
  const id = scope.LAYOUT.districts[0].id;
  const rect = (d) => ({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 });
  const was = rect(scope.LAYOUT.districts.find((d) => d.id === id));

  scope.moveDistrict(id, { dx: 40, dy: 0 });

  const d = scope.LAYOUT.districts.find((x) => x.id === id);
  const shift = 40 * scope.spacingNow();
  assert.ok(Math.abs(d.x0 - (was.x0 + shift)) < 1e-9, "the plate stayed behind its blocks");
  assert.ok(Math.abs(d.x1 - (was.x1 + shift)) < 1e-9);
  assert.equal(d.y0, was.y0);
  // The plate is still the box around the blocks it holds, not a stale rect.
  for (const n of d.blocks) {
    assert.ok(n.gx >= d.x0 && n.gx <= d.x1, `${n.id} sits outside its own district plate`);
    assert.ok(n.gy >= d.y0 && n.gy <= d.y1, `${n.id} sits outside its own district plate`);
  }
});

test("a drop onto another district is refused, and nothing moves", () => {
  const scope = runLayout(synthetic(300, 400));
  const [a, b] = scope.LAYOUT.districts;
  // Land a exactly where b is: dropping one district onto another puts two
  // blocks on one lattice point, which the depth sort has no answer for.
  const cells = {
    dx: Math.round((b.x0 - a.x0) / scope.spacingNow()),
    dy: Math.round((b.y0 - a.y0) / scope.spacingNow()),
  };
  const before = scope.LAYOUT.nodes.map((n) => `${n.id}:${n.gx},${n.gy}`).join("|");

  assert.equal(scope.moveDistrict(a.id, cells), false, "an overlapping drop was accepted");
  assert.equal(scope.districtOffset(a.id).dx, 0, "a refused drop still recorded an offset");
  assert.equal(scope.LAYOUT.nodes.map((n) => `${n.id}:${n.gx},${n.gy}`).join("|"), before);
});

test("R restores the computed layout exactly", () => {
  const scope = runLayout(synthetic(300, 400));
  const before = scope.LAYOUT.nodes.map((n) => `${n.id}:${n.gx},${n.gy}`).join("|");

  scope.moveDistrict(scope.LAYOUT.districts[0].id, { dx: 40, dy: 30 });
  scope.moveDistrict(scope.LAYOUT.districts[2].id, { dx: -25, dy: 12 });
  assert.notEqual(scope.LAYOUT.nodes.map((n) => `${n.id}:${n.gx},${n.gy}`).join("|"), before);

  assert.equal(scope.resetOffsets(), true);
  assert.equal(scope.LAYOUT.nodes.map((n) => `${n.id}:${n.gx},${n.gy}`).join("|"), before,
    "the computed layout did not come back byte for byte");
  assert.equal(scope.resetOffsets(), false, "resetting an unmoved map still claimed to work");
});

/**
 * The cache key has to see a move.
 *
 * It encodes node COUNT, which a drag never changes — so without the epoch a
 * district could move and the static raster would keep the old picture.
 */
test("a committed drag bumps the layout epoch; a refused one does not", () => {
  const scope = runLayout(synthetic(300, 400));
  const [a, b] = scope.LAYOUT.districts;
  const start = scope.epochNow();

  scope.moveDistrict(a.id, { dx: 40, dy: 30 });
  assert.ok(scope.epochNow() > start, "a drag committed without the raster being told");

  const after = scope.epochNow();
  // Rects are re-read: `a` has just moved, so the delta that lands it on `b`
  // is measured from where it is now, not from where the test first saw it.
  const now = (id) => scope.LAYOUT.districts.find((d) => d.id === id);
  const onto = {
    dx: Math.round((now(b.id).x0 - now(a.id).x0) / scope.spacingNow()),
    dy: Math.round((now(b.id).y0 - now(a.id).y0) / scope.spacingNow()),
  };
  assert.equal(scope.moveDistrict(a.id, onto), false, "the drop was meant to be refused");
  assert.equal(scope.epochNow(), after, "a refused drop re-rasterised for nothing");
});

/**
 * Grabbing one. Same discipline as pickNode: the polygon that answers has to be
 * the polygon that was drawn, or the map is a thing you can click on and be
 * lied to by.
 */
test("a district is picked at its own centre, and follows when dragged", () => {
  const scope = runLayout(synthetic(300, 400));
  const at = (d) => {
    const w = scope.project((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, 0);
    return scope.toScreen(w);
  };
  const d = scope.LAYOUT.districts[1];
  assert.equal(scope.pickDistrict(at(d).x, at(d).y)?.id, d.id);

  scope.moveDistrict(d.id, { dx: 40, dy: 30 });
  const moved = scope.LAYOUT.districts.find((x) => x.id === d.id);
  assert.equal(scope.pickDistrict(at(moved).x, at(moved).y)?.id, d.id,
    "the district moved but its hit box did not follow");
});

/** The drag maths: screen delta -> ground cells has to round-trip. */
test("unproject inverts project on the ground plane, at every yaw", () => {
  const scope = runLayout(synthetic(60, 40));
  for (let i = 0; i < 24; i++) {
    scope.setYaw((i * Math.PI) / 12);
    for (const [gx, gy] of [[3, 7], [-2, 5], [0, 0], [1.5, -4]]) {
      const p = scope.project(gx, gy, 0);
      const u = scope.unproject(p.x, p.y);
      assert.ok(Math.abs(u.gx - gx) < 1e-9 && Math.abs(u.gy - gy) < 1e-9,
        `yaw ${i}: ${gx},${gy} came back ${u.gx},${u.gy}`);
    }
  }
  scope.setYaw(scope.YAW0);
});

/* ── grouping ───────────────────────────────────────────────────────────────
   Columns mean one of two things, and the toggle is the whole of the
   difference: `folder` puts a district where the files sit on disk, `layer`
   puts it where the classifier says they belong. Everything downstream keys
   off `groupKeyOf`, so it is the one place worth pinning.                   */

/** A payload with two services — one rooted in a subdirectory, one at the repo root. */
function grouped() {
  const p = synthetic(4, 0);
  p.services = [
    { id: "api", label: "API", lang: "ts", root: "services/api", order: 0 },
    { id: "root", label: "ROOT", lang: "ts", root: null, order: 1 },
  ];
  p.nodes = [
    { ...p.nodes[0], id: "services/api/src/routes/a.ts", dir: "services/api/src/routes", service: "api", layer: "route" },
    { ...p.nodes[1], id: "services/api/src/db/b.ts", dir: "services/api/src/db", service: "api", layer: "repository" },
    { ...p.nodes[2], id: "services/api/index.ts", dir: "services/api", service: "api", layer: "entry" },
    { ...p.nodes[3], id: "main.ts", dir: ".", service: "root", layer: "entry" },
  ];
  p.layers = [
    { id: "entry", label: "ENTRY", rank: 0, color: "#111111" },
    { id: "route", label: "ROUTE", rank: 1, color: "#222222" },
    { id: "repository", label: "REPOSITORY", rank: 2, color: "#333333" },
  ];
  p.edges = [];
  return p;
}

test("folder grouping names a district by where the files sit, relative to their service", () => {
  const scope = runLayout(grouped());
  scope.S.group = "folder";
  const key = (id) => scope.groupKeyOf(scope.LAYOUT.nodes.find((n) => n.id === id)
    ?? { ...grouped().nodes.find((n) => n.id === id) });

  // The service root is stripped: a monorepo columns by src/routes, not by the
  // prefix every one of its files shares, which would be one column for everything.
  assert.equal(key("services/api/src/routes/a.ts"), "src/routes");
  assert.equal(key("services/api/src/db/b.ts"), "src/db");
  // A file sitting directly in its service root has no subfolder to name.
  assert.equal(key("services/api/index.ts"), "·");
  // And a service with no root at all is the repo itself, so `.` reads the same way.
  assert.equal(key("main.ts"), "·");
});

test("layer grouping is unchanged by the toggle existing", () => {
  const scope = runLayout(grouped());
  scope.S.group = "layer";
  for (const n of scope.LAYOUT.nodes) assert.equal(scope.groupKeyOf(n), n.layer);
});

test("columns order by rank in layer mode and alphabetically in folder mode", () => {
  const scope = runLayout(grouped());
  scope.S.group = "layer";
  assert.ok(scope.keyCompare("entry", "repository") < 0, "rank decides, not the alphabet");
  assert.equal(scope.labelForKey("repository"), "REPOSITORY");

  scope.S.group = "folder";
  assert.ok(scope.keyCompare("src/db", "src/routes") < 0);
  // Endpoints have no folder of their own, so they lead rather than sorting
  // into the middle of the paths under a letter nobody chose.
  assert.ok(scope.keyCompare("endpoints", "src/db") < 0);
  assert.equal(scope.labelForKey("src/db"), "src/db", "a path is its own label — upper-casing it would be a different path");
});

test("switching the axis re-columns the same blocks, and loses none of them", () => {
  const scope = runLayout(grouped());
  const ids = () => scope.LAYOUT.nodes.map((n) => n.id).sort();

  scope.S.group = "layer";
  scope.relayout();
  const byLayer = scope.LAYOUT.districts.map((d) => d.key).sort();
  const before = ids();

  scope.S.group = "folder";
  scope.relayout();
  const byFolder = scope.LAYOUT.districts.map((d) => d.key).sort();

  assert.deepEqual(ids(), before, "every block survives the switch");
  assert.notDeepEqual(byFolder, byLayer, "and they are actually columned differently");
  assert.ok(byFolder.includes("src/routes"));
  assert.ok(byLayer.includes("route"));
});
