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
import { DEFAULT_THEME } from "../src/model/theme.mjs";
import { buildViews } from "../src/model/views.mjs";

const MODULES = ["00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js", "40-packets.js", "50-render.js"];

/** Just enough canvas to count what the renderer asks for. */
function fakeContext(counts) {
  const noop = () => {};
  return new Proxy(
    {
      canvas: { width: 0, height: 0 },
      measureText: (t) => ({ width: t.length * 6 }),
      setTransform: noop,
      drawImage: () => counts.drawImage++,
      fillRect: noop,
      clearRect: noop,
      save: noop, restore: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, quadraticCurveTo: noop, arc: noop,
      fill: noop, stroke: noop, fillText: noop, strokeText: noop, setLineDash: noop,
    },
    { get: (t, k) => (k in t ? t[k] : undefined), set: () => true },
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
  const counts = { drawStatic: 0, drawImage: 0 };
  const source =
    MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("") +
    `
    setYaw(S.yaw);
    relayout();
    resize();
    const _drawStatic = drawStatic;
    globalThis.scope = {
      S, draw, relayout, reproject, setYaw, colorOf, applyTheme, LAYOUT, counts: __counts,
      wrap: () => { drawStatic = function () { __counts.drawStatic++; return _drawStatic.apply(this, arguments); }; },
    };
    `;
  const ctx = vm.createContext({
    ATLAS: atlas,
    console,
    __counts: counts,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
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
    meta: { schemaVersion: 1, repo: "synthetic", suiteCount: 0 },
    services, layers, nodes, edges, endpoints: [], flows: [], groups: [],
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
