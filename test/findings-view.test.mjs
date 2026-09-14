/**
 * The FINDINGS view — the half of Phase 5 a person sees.
 *
 * The engine (test/findings.test.mjs) proves what is found. This proves what
 * happens to it: that every finding is listed including the muted ones, that
 * selecting one lights its evidence ON the map instead of replacing the map,
 * that severity survives being read without colour, and that a repository with
 * nothing wrong with it gets a legible answer rather than an empty panel.
 *
 * The viewer is one concatenated script, so it is loaded here the way the
 * browser gets it: every module in filename order, in one scope, over a DOM
 * small enough to reason about. That DOM refuses `innerHTML` on anything but
 * the empty string, which is the guarantee the source reader already lives
 * under (test/source.test.mjs) extended to the panels — a finding's `message`
 * is built from repository paths, and it must reach the document as text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VIEWER_DIR } from "../src/build/assemble.mjs";
import { buildViews } from "../src/model/chrome.mjs";
import { scanFixture, requireCorpus, scanTaxvault } from "./helpers.mjs";

/**
 * Everything but the vendored highlighter (a tokenizer this view never asks
 * for) and the boot file (which starts an animation loop).
 */
const MODULES = [
  "00-theme.js", "10-state.js", "15-helpers.js", "20-select.js", "30-layout.js",
  "40-packets.js", "50-render.js", "60-pick.js", "70-inspect.js", "72-source.js",
  "75-findings.js", "79-live.js", "80-sidebar.js", "85-camera.js", "88-interact.js",
];

function fakeContext(counts) {
  const state = { lineWidth: 1, globalAlpha: 1, dash: null, fillStyle: "" };
  const stack = [];
  let curved = false;
  const noop = () => {};
  return new Proxy(
    {
      canvas: { width: 0, height: 0 },
      measureText: (t) => ({ width: String(t).length * 6 }),
      createRadialGradient: () => ({ addColorStop: noop }),
      setTransform: noop,
      drawImage: noop,
      fillRect: () => counts.fillRect++,
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
        counts.strokes.push({ w: state.lineWidth, dash: state.dash, color: state.strokeStyle });
        if (curved) counts.arcs.push({ w: state.lineWidth, dash: state.dash, color: state.strokeStyle });
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
 * `innerHTML = ""` is how the existing panels clear themselves, so it is
 * allowed and does exactly that. Any other value throws, which is the point —
 * a finding's message names files, and a file can be called anything.
 */
function fakeDom(counts) {
  const textNode = (data) => ({ nodeType: 3, data });
  const make = (tag) => {
    const kids = [];
    const node = {
      nodeType: 1, tagName: String(tag).toUpperCase(), className: "", childNodes: kids,
      style: { setProperty() {} }, dataset: {}, hidden: false, disabled: false,
      width: 0, height: 0, value: "", checked: false, open: false, title: "",
      classList: {
        add(c) { node.className = `${node.className} ${c}`.trim(); },
        remove(c) { node.className = node.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
        toggle(c, on) { on ? this.add(c) : this.remove(c); },
        contains(c) { return node.className.split(/\s+/).includes(c); },
      },
      get children() { return kids.filter((c) => c.nodeType === 1); },
      get textContent() {
        return kids.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join("");
      },
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

/** The whole viewer, in one scope, over one payload. */
function load(atlas, protocol = "http:") {
  const counts = { fillRect: 0, strokes: [], arcs: [] };
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
       S, VIEWS, counts: __counts, byId,
       // A getter, not a snapshot: relayout() REPLACES LAYOUT, so a captured
       // reference is the empty one the module started with.
       get LAYOUT() { return LAYOUT; },
       get ambient() { return ambient; },
       setView, draw, relayout, renderList, renderInspect, renderStats, renderLegend,
       selectFinding, findSelected, easeFindings, findEvidenceIds,
       veil: () => findVeil,
       $: (sel) => document.querySelector(sel),
     };`.replace("__counts", "counts"),
    ctx,
    { timeout: 60_000 },
  );
  return ctx.scope;
}

/** Every row the findings list rendered, as plain data. */
function rows(scope) {
  return scope.$("#list").children
    .filter((c) => c.className.includes("row"))
    .map((c) => ({
      className: c.className,
      text: c.textContent,
      finding: c.dataset.finding,
      sev: c.children.find((k) => k.className.startsWith("sev"))?.textContent ?? null,
      click: c.onclick,
    }));
}

const headings = (scope) =>
  scope.$("#list").children.filter((c) => c.className.includes("grp")).map((c) => c.textContent);

async function fixture() {
  const { payload } = await scanFixture("mini-monorepo");
  return payload;
}

/* ── the view itself ──────────────────────────────────────────── */

test("the findings view is a kind, not an id the viewer knows by name", () => {
  const views = buildViews({}, [], []);
  const f = views.find((v) => v.kind === "findings");
  assert.ok(f, "a findings view is always offered");
  assert.equal(f.id, "findings");
  assert.ok(f.title && f.hint, "the strip and the sidebar both have copy to show");
});

test("a config written before findings existed still gets the view", () => {
  const views = buildViews({ views: [{ id: "structure", label: "MAP" }] }, [], []);
  assert.deepEqual(views.map((v) => v.id), ["structure", "findings"]);
});

/* ── the list ─────────────────────────────────────────────────── */

test("every finding is listed, grouped the way the CLI groups them", async () => {
  const p = await fixture();
  assert.ok(p.findings.length >= 2, "the fixture is the point of this test");
  const scope = load(p);
  scope.setView("findings");

  const listed = rows(scope);
  assert.equal(listed.length, p.findings.length, "one row per finding");
  // Grouped by type, in the payload's own order — `atlas findings` prints the
  // same headings over the same partition.
  assert.deepEqual(headings(scope), [...new Set(p.findings.map((f) => f.type.toUpperCase()))].map((t) => `${t} (1)`));
  for (const f of p.findings) {
    assert.ok(listed.some((r) => r.finding === f.id && r.text.includes(f.message)),
      `${f.id} is missing from the list`);
  }
});

test("severity is readable with the colour taken away", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("findings");
  for (const r of rows(scope)) {
    // The chip carries a word, not only a hue. Strip every colour out of the
    // page and the list still says which findings are the bad ones.
    assert.ok(["ERR", "WRN", "INF"].includes(r.sev), `no severity code on ${r.finding}`);
  }
});

test("a muted finding is shown as muted, never dropped", async () => {
  const p = await fixture();
  const target = p.findings[0];
  p.findings = p.findings.map((f) => (f.id === target.id ? { ...f, muted: true, muteReason: "known, accepted" } : f));

  const scope = load(p);
  scope.setView("findings");
  const listed = rows(scope);

  assert.equal(listed.length, p.findings.length, "muting hides nothing");
  const muted = listed.find((r) => r.finding === target.id);
  assert.ok(muted.className.includes("mute"), "the row says it is silenced");
  assert.ok(headings(scope).some((h) => h.startsWith("MUTED")), "muted findings get their own heading");
  // The strip counts it separately rather than folding it into the totals.
  assert.ok(scope.$("#stats").textContent.includes("MUTED"));
  assert.equal(scope.$("#listCount").textContent, String(p.findings.length - 1), "the count is of live findings");
});

/* ── the empty state ──────────────────────────────────────────── */

test("a repository with nothing wrong with it still gets a view and an answer", async () => {
  const p = await fixture();
  p.findings = [];
  const scope = load(p);

  assert.ok(scope.VIEWS.some((v) => v.kind === "findings"), "the view does not vanish when the list is empty");
  scope.setView("findings");

  const body = scope.$("#list").textContent;
  assert.ok(body.length > 80, "the empty state is prose, not a blank panel");
  assert.match(body, /checks/i);
  // "Nothing found" and "not measured" are different claims and the panel says so.
  assert.match(body, /not measured|entrypoint/i);
  assert.equal(rows(scope).length, 0);
  // The map is still a map: an empty finding list must never empty the city.
  assert.ok(scope.LAYOUT.nodes.length > 0, "the whole point is that the map is still there");
  scope.draw();
});

test("a payload with no findings key at all does not crash the viewer", async () => {
  const p = await fixture();
  delete p.findings;
  const scope = load(p);
  scope.setView("findings");
  scope.draw();
  assert.equal(rows(scope).length, 0);
});

/* ── the highlight ────────────────────────────────────────────── */

test("selecting a finding lights its evidence and keeps the rest of the city", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("findings");
  const before = scope.LAYOUT.nodes.length;
  assert.ok(before > 0);

  for (const f of p.findings) {
    scope.selectFinding(f.id);
    const ids = scope.LAYOUT.ids;
    // Every node the finding names is ON the map, whatever the sidebar filters
    // would otherwise have done with it — the fixture's two findings implicate
    // an endpoint and a markdown file, both of which the structure view hides.
    for (const id of f.evidence.nodes) {
      assert.ok(ids.has(id), `${f.id}: evidence ${id} is not on the map`);
    }
    // Dimmed, not removed: nothing the map was already showing went away.
    assert.ok(scope.LAYOUT.nodes.length >= before, `${f.id}: selecting a finding emptied the map`);
    scope.selectFinding(f.id);   // toggles off
    assert.equal(scope.S.finding, null);
  }
});

test("the highlight is a veil over the map, not a filter of it", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("findings");

  const cycle = p.findings.find((f) => f.evidence.edges.length) ?? p.findings[0];
  scope.selectFinding(cycle.id);
  for (let i = 0; i < 60; i++) scope.easeFindings(0.016);
  assert.ok(scope.veil() > 0.8, "the veil eases in rather than cutting");

  scope.counts.arcs.length = 0;
  scope.draw();
  // One curve per implicated edge, and no others.
  assert.equal(scope.counts.arcs.length, cycle.evidence.edges.length,
    "every implicated edge is drawn, and nothing else is");
  // The drifting import packets stand down while a finding is lit: they are
  // drawn above the veil and would be the brightest thing on a map that is
  // trying to point at four blocks.
  assert.equal(scope.ambient.length, 0, "ambient packets pause for a highlight");

  // Clearing it eases back to nothing, and the map returns undimmed.
  scope.selectFinding(cycle.id);
  for (let i = 0; i < 60; i++) scope.easeFindings(0.016);
  assert.ok(scope.veil() < 0.02);
  assert.ok(scope.ambient.length > 0, "and come back when it is cleared");
});

test("a muted finding is drawn dashed rather than not drawn", async () => {
  const p = await fixture();
  const target = p.findings.find((f) => f.evidence.edges.length);
  assert.ok(target, "the fixture has an edge-bearing finding");
  p.findings = p.findings.map((f) => (f.id === target.id ? { ...f, muted: true, muteReason: "accepted" } : f));

  const scope = load(p);
  scope.setView("findings");
  scope.selectFinding(target.id);
  for (let i = 0; i < 60; i++) scope.easeFindings(0.016);
  scope.counts.arcs.length = 0;
  scope.draw();

  assert.equal(scope.counts.arcs.length, target.evidence.edges.length, "muted still draws");
  assert.ok(scope.counts.arcs.every((a) => a.dash), "muted draws dashed, so the map says it is silenced");
});

test("a finding whose evidence this scan does not contain draws nothing and throws nothing", async () => {
  const p = await fixture();
  p.findings = [{
    id: "cycle:gone", type: "cycle", severity: "error",
    message: "2 files form an import cycle: nowhere/a.ts, nowhere/b.ts",
    why: "…",
    evidence: { nodes: ["nowhere/a.ts", "nowhere/b.ts"], edges: [{ from: "nowhere/a.ts", to: "nowhere/b.ts", kind: "import" }] },
    muted: false, muteReason: null,
  }];
  const scope = load(p);
  scope.setView("findings");
  scope.selectFinding("cycle:gone");
  for (let i = 0; i < 60; i++) scope.easeFindings(0.016);
  scope.draw();
  assert.ok(scope.LAYOUT.nodes.length > 0, "the map survives a finding about nothing on it");
});

/* ── the panel ────────────────────────────────────────────────── */

test("the panel spells out severity, the fact, why it matters, and the mute", async () => {
  const p = await fixture();
  const target = { ...p.findings[0], muted: true, muteReason: "accepted for now" };
  p.findings = [target, ...p.findings.slice(1)];

  const scope = load(p);
  scope.setView("findings");
  scope.selectFinding(target.id);

  const panel = scope.$("#insBody").textContent;
  assert.ok(panel.includes("WARNING") || panel.includes("ERROR") || panel.includes("INFO"),
    "the severity is a word here, not only a colour");
  assert.ok(panel.includes(target.message), "the fact");
  assert.ok(panel.includes(target.why), "why it matters");
  assert.ok(panel.includes(target.id), "the id, which is what a config mutes");
  assert.ok(panel.includes("accepted for now"), "the mute reason travels with the finding");
  for (const id of target.evidence.nodes) {
    const n = scope.byId.get(id);
    assert.ok(panel.includes(n?.name ?? id), `evidence ${id} is listed`);
  }
});

test("a finding can open the file it names", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("findings");
  // The endpoint finding names the file its route is declared in; the orphan
  // names a file outright. Either way there is something to read.
  for (const f of p.findings) {
    scope.selectFinding(f.id);
    const jumps = scope.$("#insBody").children.filter((c) => c.className.includes("srcJump"));
    assert.ok(jumps.length > 0, `${f.id} offers no way into the source`);
    scope.selectFinding(f.id);
  }
});

test("clicking a finding's evidence hands the panel to that node, and the map keeps the highlight", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("findings");
  const f = p.findings.find((x) => x.evidence.nodes.some((id) => scope.byId.get(id)?.kind === "file")) ?? p.findings[0];
  scope.selectFinding(f.id);

  const row = scope.$("#insBody").children.find((c) => c.className === "row mini");
  assert.ok(row?.onclick, "evidence rows are clickable");
  row.onclick();
  assert.ok(scope.S.selected, "the panel moved to the node");
  assert.equal(scope.S.finding, f.id, "the finding stays lit while you read one of its files");
  assert.ok(scope.findSelected(), "and the map still knows which finding it is drawing");
});

test("a built single file shows the same findings, without offering source it does not have", async () => {
  const p = await fixture();
  // `file:` — an atlas built with `atlas build` and opened from disk. There is
  // no server to read source from, so no jump is offered rather than one that
  // fails; everything else about the view is identical.
  const scope = load(p, "file:");
  scope.setView("findings");
  assert.equal(rows(scope).length, p.findings.length);
  scope.selectFinding(p.findings[0].id);
  const panel = scope.$("#insBody");
  assert.ok(panel.textContent.includes(p.findings[0].message), "the finding still reads in full");
  assert.equal(panel.children.filter((c) => c.className.includes("srcJump")).length, 0,
    "an affordance that cannot work is worse than no affordance");
  scope.draw();
});

/* ── leaving the view ─────────────────────────────────────────── */

test("leaving the findings view drops the highlight with it", async () => {
  const p = await fixture();
  const scope = load(p);
  scope.setView("findings");
  scope.selectFinding(p.findings[0].id);
  assert.ok(scope.findSelected());

  scope.setView("structure");
  assert.equal(scope.S.finding, null);
  assert.equal(scope.findSelected(), null);
  assert.equal(scope.findEvidenceIds(), null, "the structure view is filtered by its own rules again");
  scope.draw();
});

/* ── at scale ─────────────────────────────────────────────────── */

/**
 * A real repository with a hundred findings and a real two-file cycle.
 *
 * The fixture proves the wiring; this proves the wiring survives a list long
 * enough to scroll and a map big enough to get lost in. Corpus-gated, so a
 * fresh clone stays green (CLAUDE.md, "a validation corpus, not fixtures").
 */
test("a repository with a hundred findings renders, and a cycle draws as a ring", async (t) => {
  const repo = requireCorpus(t, "taxvault");
  if (!repo) return;

  const { payload } = await scanTaxvault(repo);
  assert.ok(payload.findings.length > 20, "the corpus is the point of this test");

  const scope = load(payload);
  scope.setView("findings");
  assert.equal(rows(scope).length, payload.findings.length, "every finding is listed, at any length");

  const cycle = payload.findings.find((f) => f.type === "cycle");
  assert.ok(cycle, "this target has a real import cycle");
  scope.selectFinding(cycle.id);
  for (let i = 0; i < 60; i++) scope.easeFindings(0.016);

  for (const id of cycle.evidence.nodes) assert.ok(scope.LAYOUT.ids.has(id), `${id} is not lit`);
  scope.counts.arcs.length = 0;
  scope.draw();
  // Both directions drawn, which is the whole difference between a cycle and
  // two files that happen to be near each other.
  assert.equal(scope.counts.arcs.length, cycle.evidence.edges.length);
  assert.ok(cycle.evidence.edges.length >= 2, "a cycle is at least two hops");
});
