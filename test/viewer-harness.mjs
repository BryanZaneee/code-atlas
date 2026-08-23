/**
 * One fake browser, for the tests that drive the whole viewer.
 *
 * The viewer is a single concatenated script, so it is loaded here the way the
 * browser gets it: every module in filename order, in one scope, over a DOM
 * small enough to reason about. Three test files used to carry a copy of this
 * apiece and they drifted in the small ways copies do — a field present in one
 * element stub and missing from the next — so it lives here once.
 *
 * Not shared, on purpose: `test/render.test.mjs` counts draw calls against a
 * far thinner element stub and never inspects a panel, and
 * `test/viewer-source.test.mjs` runs a DOM whose `innerHTML` refuses *every*
 * value including the empty string. That second rule is the strictest
 * assertion in the suite and is worth reading in the file that depends on it.
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VIEWER_DIR } from "../src/build/assemble.mjs";

/**
 * Everything but the vendored highlighter (a tokenizer these views never ask
 * for) and the boot file (which starts an animation loop).
 */
export const MODULES = [
  "00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js",
  "40-packets.js", "50-render.js", "60-pick.js", "70-inspect.js", "71-notes.js", "72-source.js",
  "75-findings.js", "78-request.js", "79-live.js", "80-sidebar.js", "82-palette.js",
  "85-camera.js", "86-navigate.js", "88-interact.js",
];

/**
 * A 2D context that answers everything and records what it was asked to draw.
 *
 * `counts` is optional: without it the context is inert, which is what the
 * panel tests want — they assert on the DOM and only need the renderer not to
 * throw. With it, strokes and fills are recorded so a test can ask what the
 * map actually drew.
 */
export function fakeContext(counts = null) {
  const state = { lineWidth: 1, globalAlpha: 1, dash: null, fillStyle: "" };
  const stack = [];
  let curved = false;
  const noop = () => {};
  const bump = (k) => () => { if (counts && k in counts) counts[k]++; };
  return new Proxy(
    {
      canvas: { width: 0, height: 0 },
      measureText: (t) => ({ width: String(t).length * 6 }),
      createRadialGradient: () => ({ addColorStop: noop }),
      // The face gradient and the clip the glass material uses; both are pure
      // appearance, but the renderer calls them per block, so the stub answers.
      createLinearGradient: () => ({ addColorStop: noop }),
      clip: noop,
      setTransform: noop,
      drawImage: bump("drawImage"),
      fillRect: bump("fillRect"),
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
        if (!counts) return;
        const s = { w: state.lineWidth, alpha: state.globalAlpha, dash: state.dash, color: state.strokeStyle };
        counts.strokes?.push(s);
        if (curved) counts.arcs?.push(s);
      },
    },
    {
      get: (t, k) => (k in t ? t[k] : undefined),
      set: (t, k, v) => { state[k] = v; return true; },
    },
  );
}

/**
 * A DOM with one rule: repository text arrives as a text node.
 *
 * `innerHTML = ""` is how the panels clear themselves, so it is allowed and
 * does exactly that. Any other value throws, which is the point — a finding's
 * message and an endpoint's path both name files, and a file can be called
 * anything.
 */
export function fakeDom(counts = null) {
  const textNode = (data) => ({ nodeType: 3, data });
  const make = (tag) => {
    const kids = [];
    const node = {
      nodeType: 1, tagName: String(tag).toUpperCase(), className: "", childNodes: kids,
      style: { setProperty() {} }, dataset: {}, hidden: false, disabled: false,
      width: 0, height: 0, value: "", checked: false, open: false,
      rows: 0, type: "", placeholder: "", title: "",
      classList: {
        add(c) { node.className = `${node.className} ${c}`.trim(); },
        remove(c) { node.className = node.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
        toggle(c, on) { on ? this.add(c) : this.remove(c); },
        contains(c) { return node.className.split(/\s+/).includes(c); },
      },
      get children() { return kids.filter((c) => c.nodeType === 1); },
      get textContent() { return kids.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(""); },
      set textContent(v) { kids.length = 0; kids.push(textNode(String(v))); },
      set innerHTML(v) {
        if (v !== "") throw new Error("innerHTML: repository content must never be parsed as markup");
        kids.length = 0;
      },
      append(...items) { for (const k of items) kids.push(typeof k === "string" ? textNode(k) : k); },
      replaceChildren(...items) { kids.length = 0; node.append(...items); },
      addEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }),
      getContext: () => fakeContext(counts),
      querySelector: () => make("div"),
    };
    return node;
  };
  const bySelector = new Map();
  return {
    createElement: make,
    createTextNode: textNode,
    querySelector: (sel) => {
      if (!bySelector.has(sel)) bySelector.set(sel, make(sel === "#cv" ? "canvas" : "div"));
      return bySelector.get(sel);
    },
    querySelectorAll: () => [],
    documentElement: { setAttribute() {} },
    addEventListener() {},
  };
}

/**
 * The whole viewer, in one scope, over one payload.
 *
 * `exports` is spliced into the returned scope object literal, so a test names
 * the internals it wants to reach and gets them alongside the spine below.
 * `env` adds or replaces globals — a scripted `fetch`, a `sessionStorage` that
 * throws — and is how a test says what kind of browser this is.
 */
export function loadViewer(atlas, { protocol = "http:", counts = null, env = {}, exports = "" } = {}) {
  const source = MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("\n");
  const ctx = {
    ATLAS: atlas,
    console,
    counts,
    location: { protocol },   // "http:" is served, so jump-to-line is on offer
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    fetch: () => Promise.reject(new Error("no network in a test")),
    addEventListener: () => {},
    innerWidth: 1400,
    ...env,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.document = fakeDom(counts);
  ctx.window.devicePixelRatio = 1;
  vm.createContext(ctx);
  vm.runInContext(
    `"use strict";\n${source}\n
     setYaw(S.yaw);
     resize();
     globalThis.scope = {
       S, byId, counts,
       // A getter, not a snapshot: relayout() REPLACES LAYOUT, so a captured
       // reference is the empty one the module started with.
       get LAYOUT() { return LAYOUT; },
       setView, draw, relayout, renderList, renderInspect,
       $: (sel) => document.querySelector(sel),
       ${exports}
     };`,
    ctx,
    { timeout: 60_000 },
  );
  return ctx.scope;
}

/** Open the composer on an endpoint, with every path parameter filled. */
export function openComposer(scope, epId) {
  scope.setView("request");
  const ep = scope.reqEndpoints().find((e) => !epId || e.id === epId);
  scope.REQ.endpoint = ep;
  const st = scope.reqState(ep.id);
  for (const n of scope.reqParamNames(ep.path)) st.params[n] = "42";
  return ep;
}
