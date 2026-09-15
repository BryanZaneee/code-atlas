/**
 * Static-layer caching.
 *
 * The 60 fps drag gate is really one question: how often does the city get
 * redrawn? Screen-space caching answered "every frame", because panning moves
 * every pixel. World-space caching answers "when the content or the zoom bucket
 * changes", and a pan becomes one blit.
 *
 * That is measurable without a browser: run the renderer against a canvas stub
 * that counts draw calls, then drive it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VIEWER_DIR } from "../src/build/assemble.mjs";
import { DEFAULT_THEME, buildViews } from "../src/model/chrome.mjs";

const MODULES = ["00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js", "40-packets.js", "50-render.js", "75-findings.js", "79-live.js"];

/**
 * Just enough canvas to count what the renderer asks for.
 *
 * It also keeps the three properties that decide how a line READS — width,
 * alpha and dash — through save/restore, and records them for every curved
 * stroke. Flow hops are the only curves the renderer draws, so `counts.arcs`
 * is exactly the set of hop strokes, with the styling that was in force.
 */
function fakeContext(counts) {
  const state = { lineWidth: 1, globalAlpha: 1, dash: null };
  const stack = [];
  let curved = false;
  const noop = () => {};
  return new Proxy(
    {
      canvas: { width: 0, height: 0 },
      measureText: (t) => ({ width: t.length * 6 }),
      createRadialGradient: () => ({ addColorStop: noop }),
      // The face gradient and the drop shadow: both are pure appearance, but the
      // renderer calls them per block, so the stub has to answer.
      createLinearGradient: () => ({ addColorStop: noop }),
      clip: noop,
      setTransform: noop,
      drawImage: () => counts.drawImage++,
      fillRect: noop,
      clearRect: noop,
      save: () => stack.push({ ...state }),
      restore: () => Object.assign(state, stack.pop() ?? state),
      beginPath: () => { curved = false; },
      closePath: noop,
      moveTo: noop, lineTo: noop, arc: noop,
      quadraticCurveTo: () => { curved = true; },
      fill: noop, fillText: noop, strokeText: noop,
      setLineDash: (d) => { state.dash = d?.length ? d : null; },
      stroke: () => {
        if (curved) counts.arcs.push({ w: state.lineWidth, alpha: state.globalAlpha, dash: state.dash });
      },
    },
    {
      get: (t, k) => (k in t ? t[k] : undefined),
      set: (t, k, v) => { if (k in state) state[k] = v; return true; },
    },
  );
}

function fakeElement(counts) {
  return {
    width: 0, height: 0,
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }),
    getContext: () => fakeContext(counts),
  };
}

function runRenderer(atlas) {
  const counts = { drawStatic: 0, drawImage: 0, draw: 0, arcs: [] };
  const source =
    MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("") +
    `
    setYaw(S.yaw);
    relayout();
    resize();
    const _drawStatic = drawStatic;
    const _draw = draw;
    draw = function () { __counts.draw++; return _draw.apply(this, arguments); };
    globalThis.scope = {
      S, draw, frame, buildPackets, relayout, reproject, setYaw, colorOf, applyTheme, EDGE_STYLE, get LAYOUT() { return LAYOUT; }, stepStyle, counts: __counts, moveDistrict, resetOffsets,
      wrap: () => { drawStatic = function () { __counts.drawStatic++; return _drawStatic.apply(this, arguments); }; },
    };
    `;
  const ctx = vm.createContext({
    ATLAS: atlas,
    console,
    __counts: counts,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    window: { devicePixelRatio: 2, addEventListener() {} },
    document: { querySelector: () => fakeElement(counts), createElement: () => fakeElement(counts) },
  });
  vm.runInContext(`"use strict";\n${source}`, ctx, { timeout: 60_000 });
  ctx.scope.wrap();
  return ctx.scope;
}

function payload(n) {
  const services = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, lang: "ts", root: `s${i}`, order: i }));
  const layers = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, label: `L${i}`, rank: i, color: "#8fae74" }));
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `s${i % 4}/f${i}.ts`, name: `f${i}.ts`, dir: `s${i % 4}`,
    service: `s${i % 4}`, layer: `l${i % 5}`, lang: "ts", loc: 1 + (i * 13) % 900,
    kind: "file", exports: 0, externals: [], testKind: null, subject: null,
    inDeg: 0, outDeg: 0, coverage: "direct", uncovered: false,
  }));
  const edges = Array.from({ length: n * 2 }, (_, i) => ({
    from: nodes[i % n].id, to: nodes[(i * 7 + 1) % n].id, kind: "import", cross: false,
  }));
  return {
    meta: { schemaVersion: 2, repo: "synthetic", suiteCount: 0 },
    services, layers, nodes, edges, endpoints: [], flows: [], districts: [],
    views: buildViews({}, []), theme: DEFAULT_THEME,
  };
}

/**
 * The regression that made the offscreen canvas pointless. Every drag frame
 * changed panX/panY, the old code marked the cache dirty, and the whole city
 * was rasterised again at 60 Hz.
 */
test("panning never re-renders the static layer", () => {
  const scope = runRenderer(payload(600));
  scope.draw();                              // first frame populates the cache
  const after = scope.counts.drawStatic;
  for (let i = 0; i < 120; i++) {
    scope.S.panX += 7;
    scope.S.panY -= 3;
    scope.draw();
  }
  assert.equal(scope.counts.drawStatic, after, "a pan must be a blit, not a re-render");
  assert.equal(scope.counts.drawImage, 121, "every frame should still blit the cache");
});

/**
 * Zoom does change the rasterisation, so it must re-render — but at a bucket,
 * not continuously, or a pinch is as expensive as the old pan was.
 */
test("zooming re-renders only when it crosses a mip bucket", () => {
  const scope = runRenderer(payload(400));
  scope.draw();
  const start = scope.counts.drawStatic;

  // A 1% nudge stays inside the bucket.
  scope.S.zoom *= 1.01;
  scope.draw();
  assert.equal(scope.counts.drawStatic, start, "a small zoom should reuse the raster");

  // Doubling crosses several.
  scope.S.zoom *= 2;
  scope.draw();
  assert.equal(scope.counts.drawStatic, start + 1);
});

test("changing what is drawn does re-render", () => {
  const scope = runRenderer(payload(300));
  scope.draw();
  const start = scope.counts.drawStatic;

  scope.S.query = "f1";
  scope.draw();
  assert.equal(scope.counts.drawStatic, start + 1, "a filter changes the picture");

  scope.S.opts.labels = false;
  scope.draw();
  assert.equal(scope.counts.drawStatic, start + 2, "dropping the labels changes the picture");
});

/**
 * Selection used to be baked into the world cache, so one click re-rasterised
 * the whole city — and a hover state, which changes on every mouse move, was
 * therefore unaffordable. Both are drawn in the live pass now. This is the
 * assertion that keeps them there: it fails the moment either goes back into
 * cacheKey().
 */
test("selecting and hovering never re-render the static layer", () => {
  const scope = runRenderer(payload(600));
  scope.draw();
  const after = scope.counts.drawStatic;

  for (let i = 0; i < 60; i++) {
    scope.S.hover = scope.LAYOUT.nodes[i % scope.LAYOUT.nodes.length].id;
    scope.draw();
  }
  scope.S.selected = scope.LAYOUT.nodes[0].id;
  scope.draw();
  scope.S.selected = scope.LAYOUT.nodes[9].id;
  scope.draw();

  assert.equal(scope.counts.drawStatic, after, "state belongs in the overlay, not the cache");
});

/** A selection the current view filtered out has stale geometry; do not draw it. */
test("an overlay only draws a node that is on the map", () => {
  const scope = runRenderer(payload(200));
  scope.S.selected = "s0/nowhere.ts";
  scope.S.hover = "s0/nowhere.ts";
  scope.draw();                              // must not throw
});

/**
 * Two channels, and only one of them is optional.
 *
 * `mono` drops identity — the layer fill. It must not drop the coverage tint,
 * which says no test reaches this file, or a colour preference would quietly
 * switch off the honesty contract.
 */
test("mono drops identity colour and nothing else", () => {
  const scope = runRenderer(payload(20));
  const n = scope.LAYOUT.nodes[0];

  assert.equal(scope.colorOf(n), "#8fae74", "identity mode paints the layer colour");
  scope.S.colorMode = "mono";
  assert.equal(scope.colorOf(n), DEFAULT_THEME.face);

  scope.S.view = "tests";
  n.coverage = "none";
  assert.equal(scope.colorOf(n), DEFAULT_THEME.coverTint.none, "coverage is state, not identity");
  scope.S.colorMode = "identity";
  assert.equal(scope.colorOf(n), DEFAULT_THEME.coverTint.none);

  // `direct` has no tint by design, so it falls back to whichever channel is on.
  n.coverage = "direct";
  assert.equal(scope.colorOf(n), "#8fae74");
  scope.S.colorMode = "mono";
  assert.equal(scope.colorOf(n), DEFAULT_THEME.face);

  // The other honesty channel: a hop the tool did not observe is dotted, and no
  // colour mode may quietly make it look like one it did.
  for (const mode of ["identity", "mono"]) {
    scope.S.colorMode = mode;
    assert.deepEqual(scope.EDGE_STYLE.coupling.dash, [6, 4]);
    assert.deepEqual(scope.EDGE_STYLE["test:exercises"].dash, [3, 3]);
  }
});

test("the dark theme is a delta over the base palette", () => {
  const scope = runRenderer(payload(20));
  scope.S.colorMode = "mono";
  assert.equal(scope.colorOf(scope.LAYOUT.nodes[0]), DEFAULT_THEME.face);
  scope.applyTheme("dark");
  assert.equal(scope.colorOf(scope.LAYOUT.nodes[0]), DEFAULT_THEME.dark.face);
  scope.applyTheme("light");
  assert.equal(scope.colorOf(scope.LAYOUT.nodes[0]), DEFAULT_THEME.face);
});

test("rotating re-renders", () => {
  const scope = runRenderer(payload(300));
  scope.draw();
  const start = scope.counts.drawStatic;
  scope.setYaw(scope.S.yaw + 0.3);
  scope.reproject();
  scope.draw();
  assert.equal(scope.counts.drawStatic, start + 1);
});

test("a large payload still renders one static pass per frame at most", () => {
  const scope = runRenderer(payload(5000));
  scope.draw();
  const after = scope.counts.drawStatic;
  for (let i = 0; i < 30; i++) { scope.S.panX += 11; scope.draw(); }
  assert.equal(scope.counts.drawStatic, after);
});

/**
 * A derived path grades every hop `wired`, `imported` or `inferred`, the flow
 * blurb promises that the gaps are dotted, and for a while the renderer drew
 * all three identically — a guess and a proof, same line. This is the test that
 * keeps the honesty contract's second channel on the canvas.
 */
function derivedPayload() {
  const p = payload(40);
  const id = (i) => p.nodes[i].id;
  const flow = {
    id: "derived:x", label: "GET /x", derived: true,
    steps: [
      { from: id(0), to: id(1), kind: "request", certainty: "wired", inferred: false },
      { from: id(1), to: id(2), kind: "request", certainty: "imported", inferred: false },
      { from: id(2), to: id(3), kind: "request", certainty: "inferred", inferred: true },
    ],
  };
  p.derivedFlows = [flow];
  p.views = buildViews({}, [], [flow]);
  return p;
}

test("a derived hop draws how sure it is, not only what kind it is", () => {
  const atlas = derivedPayload();
  const scope = runRenderer(atlas);
  const base = scope.EDGE_STYLE.request;
  const graded = (certainty) => scope.stepStyle({ kind: "request", certainty });
  const wired = graded("wired"), imported = graded("imported"), inferred = graded("inferred");

  assert.ok(inferred.dash?.length, "the blurb promises dotted for a gap the graph cannot justify");
  assert.equal(wired.dash, null, "a mount the scan read is not a guess");
  assert.equal(imported.dash, null);
  assert.ok(wired.w > imported.w && imported.w > inferred.w, "weight must fall with certainty");
  assert.ok(wired.aMul > imported.aMul && imported.aMul > inferred.aMul, "and so must opacity");
  // ...but only so far. A hop that is not the current one already draws at 0.16,
  // and a guess faded under about 0.1 stops being visible against the dark
  // ground — at which point the path reads as not having that hop at all, and
  // the map looks surer than it is. Dash and weight say "inferred"; opacity is
  // not allowed to say "absent".
  assert.ok(inferred.aMul * 0.16 > 0.1, `an inferred hop must stay legible, got ${inferred.aMul * 0.16}`);
  assert.equal(wired.c, base.c, "colour still belongs to the step's kind, not its certainty");

  // A curated step has no certainty: it must come back with its table style
  // untouched, or fixing derived paths would have restyled every other flow.
  assert.deepEqual(scope.stepStyle({ kind: "request" }), base);
  assert.deepEqual(scope.stepStyle({ kind: "sql" }), scope.EDGE_STYLE.sql);

  // And the renderer has to actually ask. Reading it off the canvas is the half
  // that fails if someone drops the call and keeps the table.
  // A derived path is armed through the composer now — there is no DERIVED view
  // to switch to, so the test arms it the same way a reader would.
  scope.S.view = "request";
  scope.S.request = atlas.derivedFlows[0];
  scope.relayout();
  scope.counts.arcs.length = 0;
  scope.draw();
  assert.equal(scope.counts.arcs.length, 3, "one stroke per hop of the path");
  assert.equal(scope.counts.arcs.filter((a) => a.dash).length, 1, "exactly the inferred hop is dotted");
  const drawn = new Set(scope.counts.arcs.map((a) => `${a.w}|${a.alpha}|${a.dash}`));
  assert.equal(drawn.size, 3, "three certainties must not collapse into one line");
});

/**
 * Moving a district must re-render exactly once, and must re-render at all.
 *
 * The cache key encodes node COUNT, which a drag never changes — so without the
 * layout epoch in the key a district could move and the raster would happily
 * keep serving the picture from before it did. The other half matters just as
 * much: a drag is not allowed to cost more than one rasterisation, or arranging
 * the map becomes the one interaction that stutters.
 */
test("a committed drag re-renders the static layer exactly once", () => {
  const scope = runRenderer(payload(600));
  scope.draw();
  const before = scope.counts.drawStatic;

  assert.equal(scope.moveDistrict(scope.LAYOUT.districts[0].id, { dx: 40, dy: 30 }), true);
  scope.draw();

  assert.equal(scope.counts.drawStatic, before + 1, "a drag re-rendered more than once, or not at all");
});

test("panning after a drag is still free", () => {
  const scope = runRenderer(payload(600));
  scope.draw();
  scope.moveDistrict(scope.LAYOUT.districts[0].id, { dx: 40, dy: 30 });
  scope.draw();
  const after = scope.counts.drawStatic;

  for (let i = 0; i < 120; i++) { scope.S.panX += 7; scope.S.panY -= 3; scope.draw(); }
  assert.equal(scope.counts.drawStatic, after, "the drag left the cache invalidating on every pan");
});

/** A drop that moves nothing must not cost a rasterisation either. */
test("a drop that changes nothing does not re-render", () => {
  const scope = runRenderer(payload(600));
  scope.draw();
  const [a, b] = scope.LAYOUT.districts;
  // A drop of zero cells is the simplest thing that is guaranteed to change
  // nothing; the overlap case is pinned in layout.test.mjs, where the pitch is
  // in scope and the refusal can be asserted on its own terms.
  const before = scope.counts.drawStatic;

  assert.equal(scope.moveDistrict(a.id, { dx: 0, dy: 0 }), true);
  assert.equal(scope.LAYOUT.districts[0].x0, a.x0, "a zero-cell drop moved something");
  scope.draw();
  assert.equal(scope.counts.drawStatic, before, "a drop that moved nothing still re-rasterised the city");
});

/* ════════════════════ the on-canvas modelled-path badge ════════════════════
 *
 * `syncControls()` used to raise `#ovWarn` for a tool-derived flow only. A
 * curated flow's hops are just as modelled — build.mjs counts them in
 * meta.derivedCount for exactly that reason — but its badge was silent, which
 * is the dishonest case the honesty contract in CLAUDE.md rules out. This
 * needs the interaction layer (88-interact.js) and a DOM that keeps state
 * across `$()` calls, so it gets its own small harness rather than reusing
 * `runRenderer`, whose fake document hands back a fresh, disconnected element
 * every time.
 */

const BADGE_MODULES = [
  "00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js",
  "40-packets.js", "50-render.js", "60-pick.js", "70-inspect.js", "71-notes.js", "72-source.js",
  "75-findings.js", "80-sidebar.js", "82-palette.js", "85-camera.js", "88-interact.js",
];

function fakeBadgeElement() {
  const kids = [];
  const node = {
    nodeType: 1, className: "", childNodes: kids,
    style: { setProperty() {} }, dataset: {}, hidden: false, disabled: false,
    width: 0, height: 0, value: "", checked: false, open: false, title: "",
    classList: {
      add(c) { node.className = `${node.className} ${c}`.trim(); },
      remove(c) { node.className = node.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return node.className.split(/\s+/).includes(c); },
    },
    get textContent() { return kids.map((k) => (typeof k === "string" ? k : "")).join(""); },
    set textContent(v) { kids.length = 0; kids.push(String(v)); },
    set innerHTML(v) { if (v !== "") throw new Error("no markup"); kids.length = 0; },
    append() {}, replaceChildren() {}, addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }),
    getContext: () => fakeContext({ drawStatic: 0, drawImage: 0, arcs: [] }),
    querySelector: () => fakeBadgeElement(),
  };
  return node;
}

function loadBadgeScope(atlas) {
  const bySelector = new Map();
  const document = {
    createElement: () => fakeBadgeElement(),
    createTextNode: (d) => d,
    querySelector: (sel) => {
      if (!bySelector.has(sel)) bySelector.set(sel, fakeBadgeElement());
      return bySelector.get(sel);
    },
    querySelectorAll: () => [],
    documentElement: { setAttribute() {} },
    addEventListener() {},
  };
  const source = BADGE_MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("\n");
  const ctx = {
    ATLAS: atlas, console,
    location: { protocol: "http:" },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: () => Promise.reject(new Error("no network in a test")),
    addEventListener: () => {},
    innerWidth: 1400,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.document = document;
  ctx.window.devicePixelRatio = 1;
  vm.createContext(ctx);
  vm.runInContext(
    `"use strict";\n${source}\n
     setYaw(S.yaw);
     resize();
     globalThis.scope = { S, syncControls, $: (sel) => document.querySelector(sel) };`,
    ctx,
    { timeout: 60_000 },
  );
  return ctx.scope;
}

function badgePayload() {
  const p = payload(20);
  const id = (i) => p.nodes[i].id;
  const derived = {
    id: "derived:x", label: "GET /x", derived: true,
    steps: [{ from: id(0), to: id(1), kind: "request", certainty: "inferred", inferred: true }],
  };
  const curated = {
    id: "curated:x", label: "curated", view: "curated",
    steps: [{ from: id(0), to: id(1), kind: "request" }],
  };
  p.flows = [curated];
  p.derivedFlows = [derived];
  p.views = buildViews({}, [curated], [derived]);
  return p;
}

test("the canvas badge says DERIVED for a derived flow, CURATED for a curated one, and nothing for neither", () => {
  const scope = loadBadgeScope(badgePayload());

  scope.S.activeFlow = "derived:x";
  scope.syncControls();
  assert.equal(scope.$("#ovWarn").textContent, "DERIVED · NOT VERIFIED",
    "a tool-derived path must say so on the map, not only in the sidebar");

  scope.S.activeFlow = "curated:x";
  scope.syncControls();
  assert.equal(scope.$("#ovWarn").textContent, "CURATED · MODELLED PATH",
    "a curated flow's hops are modelled too — build.mjs counts them the same way");

  scope.S.activeFlow = "__all__";
  scope.syncControls();
  assert.equal(scope.$("#ovWarn").textContent, "", "no active flow, no caveat to show");
});

/* ════════════════════ the render loop idles ════════════════════ */

/**
 * The loop used to call draw() on every rAF tick forever, so a static map
 * repainted the whole canvas at 60 Hz with nothing changing — the single
 * biggest cost on a small machine. Packet drift is real motion and still
 * draws; a still map must not.
 */
test("a still map draws nothing, while a drifting one keeps drawing", () => {
  const r = runRenderer(payload(300));
  const frames = (n) => { const b = r.counts.draw; for (let i = 0; i < n; i++) r.frame(i * 16.7); return r.counts.draw - b; };

  r.S.opts.ambient = true;
  r.buildPackets();
  assert.ok(frames(60) > 50, "ambient packets are genuinely moving, so the loop must draw");

  r.S.opts.ambient = false;
  r.buildPackets();
  frames(3);                                   // let the veils settle
  assert.equal(frames(60), 0, "nothing is moving and nothing changed — the loop must idle");

  r.S.running = false;
  frames(3);
  assert.equal(frames(60), 0, "paused as well");
});

/**
 * The risk the idle check carries: a state change the signature cannot see
 * leaves a stale frame on screen forever. Each of these must wake the loop.
 */
test("every state change still wakes the idle loop", () => {
  const r = runRenderer(payload(300));
  r.S.opts.ambient = false;
  r.buildPackets();
  const ids = r.LAYOUT.nodes.map((n) => n.id);

  const wakes = (label, mutate) => {
    for (let i = 0; i < 3; i++) r.frame(0);     // settle into idle
    const before = r.counts.draw;
    mutate();
    r.frame(0);
    assert.ok(r.counts.draw > before, `${label} left a stale frame`);
  };

  wakes("selecting a block", () => { r.S.selected = ids[0]; });
  wakes("hovering a block", () => { r.S.hover = ids[1]; });
  wakes("panning", () => { r.S.panX += 40; });
  wakes("zooming", () => { r.S.zoom *= 1.3; });
  wakes("searching", () => { r.S.query = "fmt"; });
  wakes("toggling labels", () => { r.S.opts.labels = false; });
  wakes("switching view", () => { r.S.view = "tests"; });
  wakes("picking a finding", () => { r.S.finding = "x"; });
  wakes("changing density", () => { r.S.density = 1.4; });
  wakes("toggling the ground", () => { r.S.ground = false; });
  wakes("rotating", () => { r.S.yaw += 0.3; });
  wakes("focusing a district", () => { r.S.focusDistrict = r.LAYOUT.districts[0].id; });
});
