/**
 * The REQUEST view — Phase 8's composer.
 *
 * The thing this file is really guarding is the honesty contract, because the
 * composer is where it is easiest to break: putting real values into a modelled
 * path is exactly what makes a modelled path read as an observed one. So the
 * assertions below care less about whether a field renders than about whether
 * the map can overstate itself — that a hop with no import behind it is drawn
 * dotted and offered no line to open, that a curated flow's hops are still
 * marked modelled, and that nothing is ever fetched.
 *
 * The second concern is the authorization value. It must never reach storage,
 * and asserting "the redactor was called" would prove nothing; the test looks
 * for the token in the serialized string instead.
 *
 * Loaded the way test/findings-view.test.mjs loads it: every module in filename
 * order, one scope, over a DOM that refuses `innerHTML` on anything but the
 * empty string. An endpoint's path and a node's id are repository strings and
 * both reach this panel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VIEWER_DIR } from "../src/build/assemble.mjs";
import { buildViews } from "../src/model/chrome.mjs";
import { validateFlows, scan } from "../src/build/build.mjs";
import { scanFixture, FIXTURE_DIR } from "./helpers.mjs";

const MODULES = [
  "00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js",
  "40-packets.js", "50-render.js", "60-pick.js", "70-inspect.js", "71-notes.js", "72-source.js",
  "75-findings.js", "78-request.js", "79-live.js", "80-sidebar.js", "82-palette.js", "85-camera.js", "88-interact.js",
];

function fakeContext() {
  const state = {};
  const noop = () => {};
  return new Proxy(
    {
      canvas: { width: 0, height: 0 },
      measureText: (t) => ({ width: String(t).length * 6 }),
      createRadialGradient: () => ({ addColorStop: noop }),
      // The face gradient and the clip the glass material uses; both are pure
      // appearance, but the renderer calls them per block, so the stub answers.
      createLinearGradient: () => ({ addColorStop: noop }),
      clip: noop,
      setTransform: noop, drawImage: noop, fillRect: noop, clearRect: noop,
      save: noop, restore: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, arc: noop, quadraticCurveTo: noop,
      fill: noop, fillText: noop, strokeText: noop, setLineDash: noop, stroke: noop,
    },
    { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => { state[k] = v; return true; } },
  );
}

function fakeDom() {
  const textNode = (data) => ({ nodeType: 3, data });
  const make = (tag) => {
    const kids = [];
    const node = {
      nodeType: 1, tagName: String(tag).toUpperCase(), className: "", childNodes: kids,
      style: { setProperty() {} }, dataset: {}, hidden: false, disabled: false,
      width: 0, height: 0, value: "", rows: 0, type: "", placeholder: "", title: "",
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
      getContext: () => fakeContext(),
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

/** A sessionStorage that records, or one that throws the way a locked-down browser does. */
function fakeStorage(hostile) {
  const map = new Map();
  const boom = () => { throw new Error("sessionStorage is not available"); };
  return {
    raw: map,
    api: hostile
      ? { get getItem() { return boom(); }, get setItem() { return boom(); } }
      : { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) },
  };
}

function load(atlas, { protocol = "http:", hostile = false, storage = fakeStorage(hostile) } = {}) {
  const source = MODULES.map((f) => readFileSync(path.join(VIEWER_DIR, f), "utf8")).join("\n");
  const ctx = {
    ATLAS: atlas,
    console,
    location: { protocol },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    fetch: () => Promise.reject(new Error("no network in a test")),
    addEventListener: () => {},
    innerWidth: 1400,
    sessionStorage: storage.api,
    navigator: {},
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.document = fakeDom();
  ctx.window.devicePixelRatio = 1;
  vm.createContext(ctx);
  vm.runInContext(
    `"use strict";\n${source}\n
     setYaw(S.yaw);
     resize();
     globalThis.scope = {
       S, REQ, byId,
       get LAYOUT() { return LAYOUT; },
       get runners() { return runners; },
       setView, draw, relayout, renderList, renderInspect,
       reqEndpoints, reqParamNames, reqState, reqUrl, reqBodyCheck, reqRedactHeaders,
       reqSave, reqGrade, reqHopEvidence, reqHopJump, reqFlowFor, reqSend, reqCurateSource,
       $: (sel) => document.querySelector(sel),
     };`,
    ctx,
    { timeout: 60_000 },
  );
  ctx.scope.storage = storage;
  return ctx.scope;
}

async function fixture() {
  const { payload } = await scanFixture("mini-monorepo");
  return payload;
}

/** Open the request view against the first endpoint, with every param filled. */
function open(scope, epId) {
  scope.setView("request");
  const ep = scope.reqEndpoints().find((e) => !epId || e.id === epId);
  scope.REQ.endpoint = ep;
  const st = scope.reqState(ep.id);
  for (const n of scope.reqParamNames(ep.path)) st.params[n] = "42";
  return ep;
}

const listRows = (scope) => scope.$("#list").children.filter((c) => c.className.includes("row"));
const panelText = (scope) => scope.$("#insBody").textContent;

/* ── the view ─────────────────────────────────────────────────── */

test("the request view is a kind, and only exists where there is an HTTP surface", () => {
  const withEps = buildViews({}, [], [], [{ id: "GET /x" }]);
  const v = withEps.find((x) => x.kind === "request");
  assert.ok(v, "a repo with endpoints is offered the composer");
  assert.ok(v.title && v.hint, "it carries its own title and hint copy");
  assert.equal(buildViews({}, [], [], []).some((x) => x.kind === "request"), false,
    "a repo with no endpoints is not offered an empty composer");
});

test("a config written before Phase 8 still gets the view", () => {
  const views = buildViews({ views: [{ id: "structure" }] }, [], [], [{ id: "GET /x" }]);
  assert.ok(views.some((v) => v.kind === "request"));
});

test("the sidebar lists every endpoint, with its method and path as text", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("request");
  scope.renderList();
  const rows = listRows(scope);
  assert.equal(rows.length, p.endpoints.length);
  for (const ep of p.endpoints) {
    assert.ok(rows.some((r) => r.textContent.includes(ep.path) && r.textContent.includes(ep.method)),
      `${ep.id} is listed`);
  }
});

/* ── composing ────────────────────────────────────────────────── */

test("path parameters are found in both framework syntaxes", async () => {
  const scope = load(await fixture());
  // Spread across the realm boundary: the VM's Array has a different prototype,
  // which deepEqual compares even when every element matches.
  const names = (p) => [...scope.reqParamNames(p)];
  assert.deepEqual(names("/users/:id/posts/:postId"), ["id", "postId"]);
  assert.deepEqual(names("/users/{userId}"), ["userId"]);
  assert.deepEqual(names("/health"), []);
});

test("a blank path parameter composes nothing rather than a half-substituted URL", async () => {
  const scope = load(await fixture());
  scope.setView("request");
  const ep = scope.reqEndpoints().find((e) => scope.reqParamNames(e.path).length);
  assert.ok(ep, "the fixture has a parameterised route");
  scope.REQ.endpoint = ep;
  assert.equal(scope.reqUrl(), null, "no URL while a parameter is empty");

  const st = scope.reqState(ep.id);
  st.params[scope.reqParamNames(ep.path)[0]] = "42";
  const url = scope.reqUrl();
  assert.ok(url && !url.includes(":") && !url.includes("{"), `substituted: ${url}`);
  assert.ok(url.includes("42"));
});

test("the query string is appended, and a leading ? is not doubled", async () => {
  const scope = load(await fixture());
  const ep = open(scope);
  scope.reqState(ep.id).query = "?page=2";
  assert.ok(scope.reqUrl().endsWith("?page=2"));
});

test("body validity is the parser's own answer, not a guess", async () => {
  const scope = load(await fixture());
  const ep = open(scope, "POST /api/users");
  const st = scope.reqState(ep.id);
  st.body = '{"name":"a"}';
  assert.equal(scope.reqBodyCheck().ok, true);
  st.body = "{oops";
  const bad = scope.reqBodyCheck();
  assert.equal(bad.ok, false);
  assert.ok(bad.message.length, "the parser's message is shown rather than a generic one");
});

test("SEND is disabled while the request cannot be composed, and enabled when it can", async () => {
  const scope = load(await fixture());
  const ep = open(scope, "POST /api/users");
  const st = scope.reqState(ep.id);

  st.body = "{oops";
  scope.renderInspect();
  const send = () => scope.$("#insBody").children.find((c) => c.textContent.includes("SEND (MODELED)"));
  assert.equal(send().disabled, true, "invalid JSON disables it");

  st.body = '{"name":"a"}';
  scope.renderInspect();
  assert.equal(send().disabled, false, "valid JSON enables it");
});

/* ── persistence ──────────────────────────────────────────────── */

test("the composer persists, and an authorization value never reaches storage", async () => {
  const scope = load(await fixture());
  const ep = open(scope);
  const st = scope.reqState(ep.id);
  st.query = "page=2";
  st.headers = "Accept: application/json\nAuthorization: Bearer sup3r-s3cret-token";
  scope.reqSave();

  const raw = [...scope.storage.raw.values()].join("");
  assert.ok(raw.includes("page=2"), "ordinary fields are persisted");
  assert.ok(!raw.includes("sup3r-s3cret-token"), "the token is nowhere in the serialized string");
  assert.ok(/authorization/i.test(raw), "the header NAME survives, so the row comes back empty rather than vanishing");
});

test("redaction is case-insensitive and keeps every other header intact", async () => {
  const scope = load(await fixture());
  const out = scope.reqRedactHeaders("authorization: Bearer x\nX-Trace: keep-me");
  assert.ok(!out.includes("Bearer x"));
  assert.ok(out.includes("X-Trace: keep-me"));
});

test("a sessionStorage that throws degrades to an unpersisted composer, not a broken panel", async () => {
  const scope = load(await fixture(), { hostile: true });
  const ep = open(scope);
  scope.reqState(ep.id).query = "page=2";
  assert.doesNotThrow(() => scope.reqSave());
  assert.doesNotThrow(() => scope.renderInspect());
  assert.ok(panelText(scope).includes(ep.path), "the composer still rendered");
});

/* ── playing the path ─────────────────────────────────────────── */

test("SEND arms the path and carries the substituted request, not the template", async () => {
  const scope = load(await fixture());
  const ep = open(scope, "GET /api/users/:id");
  scope.reqSend();

  assert.ok(scope.S.request, "a path is armed");
  assert.ok(scope.LAYOUT.nodes.length, "the map still has geometry");
  assert.doesNotThrow(() => scope.draw());

  const sample = scope.S.request.steps[0].sample;
  assert.ok(sample.request.includes("42"), `the entered value is in the packet: ${sample.request}`);
  assert.ok(!sample.request.includes(":id"), "the unsubstituted parameter is not");
});

test("the packet payload carries no authorization value into the document", async () => {
  const scope = load(await fixture());
  const ep = open(scope);
  scope.reqState(ep.id).headers = "Authorization: Bearer another-secret";
  scope.reqSend();
  const sample = JSON.stringify(scope.S.request.steps[0].sample);
  assert.ok(!sample.includes("another-secret"));
});

test("an endpoint with no curated and no derived path says so instead of offering a dead button", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("request");
  const ep = scope.reqEndpoints()[0];
  scope.REQ.endpoint = ep;
  for (const n of scope.reqParamNames(ep.path)) scope.reqState(ep.id).params[n] = "1";
  // Strip every path the payload offers, so reqFlowFor has nothing to return.
  p.flows = []; p.derivedFlows = [];
  const bare = load(p);
  bare.setView("request");
  bare.REQ.endpoint = bare.reqEndpoints()[0];
  for (const n of bare.reqParamNames(bare.REQ.endpoint.path)) bare.reqState(bare.REQ.endpoint.id).params[n] = "1";
  bare.renderInspect();
  assert.equal(bare.reqFlowFor(bare.REQ.endpoint), null);
  assert.match(panelText(bare), /nobody curated one|derivation found none/i);
});

/* ── certainty and audit ──────────────────────────────────────── */

test("a hop with no evidence behind it is graded inferred, never drawn solid", async () => {
  const scope = load(await fixture());
  const invented = scope.reqGrade({ from: "services/api/src/server.ts", to: "services/worker/src/worker.ts", kind: "request" });
  assert.equal(invented.certainty, "inferred");
  assert.equal(invented.inferred, true);
  assert.equal(scope.reqHopEvidence(invented), null, "and nothing is offered to open");
});

test("every non-inferred hop of an armed path has evidence behind it", async () => {
  const scope = load(await fixture());
  open(scope, "GET /api/users");
  scope.reqSend();
  for (const s of scope.S.request.steps) {
    if (s.certainty === "inferred") {
      assert.equal(scope.reqHopJump(s), null, `an inferred hop is offered no jump: ${s.from} -> ${s.to}`);
    } else {
      assert.ok(scope.reqHopEvidence(s), `a solid hop names its evidence: ${s.from} -> ${s.to}`);
    }
  }
});

test("a page with no server offers no jump, and still says how sure each hop is", async () => {
  const scope = load(await fixture(), { protocol: "file:" });
  open(scope, "GET /api/users");
  scope.reqSend();
  scope.renderInspect();
  for (const s of scope.S.request.steps) {
    assert.equal(scope.reqHopJump(s), null, "no jump is offered from a file:// atlas");
  }
  assert.match(panelText(scope), /wired|imported|inferred/,
    "the certainty words are still rendered without a reader behind them");
});

/* ── curate ───────────────────────────────────────────────────── */

test("the emitted entry is JavaScript, and its ids survive being repository paths", async () => {
  const scope = load(await fixture());
  open(scope, "GET /api/users");
  scope.reqSend();
  const src = scope.reqCurateSource();
  const entry = vm.runInNewContext(`(${src})`);
  assert.ok(entry.id && entry.label && Array.isArray(entry.steps) && entry.steps.length);
  for (const s of entry.steps) {
    assert.equal(typeof s.from, "string");
    assert.equal(typeof s.to, "string");
    assert.ok(!("certainty" in s), "this tool's grading of its own guess is not emitted as a person's claim");
  }
});

test("GATE: the emitted entry pastes into a config and validates", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const scope = load(payload);
  open(scope, "GET /api/users");
  scope.reqSend();
  const entry = vm.runInNewContext(`(${scope.reqCurateSource()})`);

  // 1. the tool's own validator, not a re-implementation of it
  const nodeIds = new Set(payload.nodes.map((n) => n.id));
  assert.deepEqual(validateFlows({ flows: [entry] }, nodeIds), [],
    "every from/to resolves to a node the scan produced");

  // 2. a real scan with it, under --strict, which makes a stale flow fatal
  const warnings = [];
  const config = (await import(path.join(FIXTURE_DIR, "mini-monorepo", "atlas.config.mjs"))).default;
  const out = await scan({
    repo: path.join(FIXTURE_DIR, "mini-monorepo"),
    ref: "fs",
    config: { ...config, flows: [...(config.flows ?? []), entry] },
    strict: true,
    warn: (m) => warnings.push(m),
  });
  assert.deepEqual(warnings, [], "nothing about the pasted entry is stale");
  assert.ok(out.payload.flows.some((f) => f.id === entry.id), "it ships as a flow");
  const view = out.payload.views.find((v) => v.id === entry.view);
  assert.ok(view && view.kind === "flow", "and the strip gains a playable view for it");
});
