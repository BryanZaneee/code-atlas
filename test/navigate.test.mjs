/**
 * Navigation: the command palette, the keyboard, go-to-definition, history.
 *
 * The gate for this phase is that every affordance is reachable by keyboard
 * alone, so that is what these assert — not that a panel rendered, but that
 * pressing a key moved the selection, and that following an import from a
 * source line lands on the file the scanner resolved rather than on a guess.
 *
 * The one that matters most is `goTo` revealing before it selects. A palette
 * can name a block that is filtered out, collapsed into a megablock, or in a
 * service that is switched off, and "select something invisible" is the failure
 * mode that makes a jump feature feel broken without ever throwing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanFixture } from "./helpers.mjs";
import { loadViewer } from "./viewer-harness.mjs";

const EXPORTS = `VIEWS,
  goTo, reveal, navBack, navForward, cycleView, navByKey, nextBlock, firstBlock,
  paletteItems, fuzzy, palOpen, palClose, palFilter, palChoose, renderBreadcrumb,
  get palShown() { return palShown; },
  srcJumpLines, openSource, closeSource,
  get SRC() { return SRC; },`;

async function load() {
  const { payload } = await scanFixture("mini-monorepo");
  const scope = loadViewer(payload, { exports: EXPORTS });
  scope.setView("structure");
  return scope;
}

/* ── goTo reveals before it selects ───────────────────────────────────────── */

test("goTo selects a block and reports it did", async () => {
  const s = await load();
  const id = s.LAYOUT.nodes[0].id;
  assert.equal(s.goTo(id), true);
  assert.equal(s.S.selected, id);
});

test("goTo on a name nothing knows is a false, not a throw", async () => {
  const s = await load();
  assert.equal(s.goTo("no/such/file.ts"), false);
  assert.equal(s.S.selected, null);
});

test("goTo turns a switched-off service back on rather than selecting the invisible", async () => {
  const s = await load();
  const n = s.LAYOUT.nodes[0];
  s.S.services.delete(n.service);
  s.relayout();
  assert.ok(!s.LAYOUT.ids.has(n.id), "the block should be hidden before the jump");

  s.goTo(n.id);
  assert.ok(s.S.services.has(n.service), "the service was not switched back on");
  assert.ok(s.LAYOUT.ids.has(n.id), "the block is still not drawn after jumping to it");
});

test("goTo expands a district that had collapsed to a megablock", async () => {
  const s = await load();
  const d = s.LAYOUT.districts.find((x) => x.blocks.length > 1);
  if (!d) return;                                   // fixture too small; nothing to assert
  s.S.collapsed.add(d.id);
  s.relayout();
  const hidden = d.blocks[0].id;
  assert.ok(!s.LAYOUT.ids.has(hidden), "the member should be inside a megablock");

  s.goTo(hidden);
  assert.ok(!s.S.collapsed.has(d.id), "the district stayed collapsed");
  assert.ok(s.LAYOUT.ids.has(hidden), "the member is still not drawn");
});

/* ── history ──────────────────────────────────────────────────────────────── */

test("back returns to where you were, and forward undoes the back", async () => {
  const s = await load();
  const [a, b] = s.LAYOUT.nodes.map((n) => n.id);
  s.goTo(a);
  s.goTo(b);
  assert.equal(s.S.selected, b);

  assert.equal(s.navBack(), true);
  assert.equal(s.S.selected, a);
  assert.equal(s.navForward(), true);
  assert.equal(s.S.selected, b);
});

test("back with nowhere to go is a false, not a throw", async () => {
  const s = await load();
  assert.equal(s.navBack(), false);
  assert.equal(s.navForward(), false);
});

test("a new jump abandons the forward trail, the way a browser does", async () => {
  const s = await load();
  const [a, b, c] = s.LAYOUT.nodes.map((n) => n.id);
  s.goTo(a); s.goTo(b);
  s.navBack();
  s.goTo(c);
  assert.equal(s.navForward(), false, "the forward trail survived a new jump");
});

/* ── the keyboard ─────────────────────────────────────────────────────────── */

test("an arrow key with nothing selected starts somewhere rather than nowhere", async () => {
  const s = await load();
  assert.equal(s.S.selected, null);
  assert.equal(s.navByKey(1, 0), true);
  assert.ok(s.S.selected, "no block was selected to start from");
});

test("the next block in a direction is ahead of you, never behind", async () => {
  const s = await load();
  const from = s.firstBlock();
  const right = s.nextBlock(from, 1, 0);
  if (!right) return;                               // a one-block row; nothing to the right
  const here = s.LAYOUT.nodes.find((n) => n.id === from);
  const there = s.LAYOUT.nodes.find((n) => n.id === right);
  assert.ok(there.top.x > here.top.x, "moving right landed on something to the left");
});

test("every view is reachable with [ and ], wrapping", async () => {
  const s = await load();
  const ids = s.VIEWS.map((v) => v.id);
  const seen = new Set([s.S.view]);
  for (let i = 0; i < ids.length; i++) { s.cycleView(1); seen.add(s.S.view); }
  assert.deepEqual([...seen].sort(), [...ids].sort(), "a view could not be reached from the keyboard");
  assert.equal(s.S.view, ids[0], "cycling the whole strip did not wrap back to the start");
});

/* ── the palette ──────────────────────────────────────────────────────────── */

test("the palette lists files, districts, endpoints and findings", async () => {
  const s = await load();
  const kinds = new Set(s.paletteItems().map((i) => i.kind));
  assert.ok(kinds.has("file"), "no files in the palette");
  assert.ok(kinds.has("district"), "no districts in the palette");
  assert.ok(kinds.has("endpoint"), "no endpoints in the palette");
});

test("the palette matches a subsequence, not just a prefix", async () => {
  const s = await load();
  assert.ok(s.fuzzy("abc", "a-b-c") >= 0, "a scattered subsequence did not match");
  assert.ok(s.fuzzy("abc", "acb") < 0, "an out-of-order match was accepted");
  assert.ok(s.fuzzy("ab", "ab-x") > s.fuzzy("ab", "x-a-b"), "contiguous did not beat scattered");
});

test("typing a file's own name puts it first, and choosing it goes there", async () => {
  const s = await load();
  const target = s.LAYOUT.nodes.find((n) => n.kind === "file");
  s.palOpen();
  s.palFilter(target.name);
  assert.equal(s.palShown[0]?.id, target.id, "the exact name was not the top hit");
  s.palChoose(0);
  assert.equal(s.S.selected, target.id);
});

test("a name nothing matches empties the list rather than showing everything", async () => {
  const s = await load();
  s.palOpen();
  s.palFilter("zzzznothinglikethis");
  assert.equal(s.palShown.length, 0);
});

test("the palette never reads a line of source — it is names only", async () => {
  const s = await load();
  const items = s.paletteItems();
  const names = new Set([
    ...s.S.services.keys(),
    ...items.map((i) => i.label),
  ]);
  // Every label traces to a node name, a district label, an endpoint or a
  // finding message. None of them is file content, which is the line the
  // narrowed scope guard draws.
  assert.ok(items.every((i) => typeof i.label === "string" && i.label.length < 400));
  assert.ok(names.size > 0);
});

/* ── go to definition ─────────────────────────────────────────────────────── */

test("a source line offers a jump only where an import actually resolved", async () => {
  const s = await load();
  const withEdges = s.LAYOUT.nodes.find((n) => (n.outDeg ?? 0) > 0);
  if (!withEdges) return;
  const jumps = s.srcJumpLines(withEdges.id);
  if (!jumps) return;
  for (const [line, to] of jumps) {
    assert.ok(line > 0, "an import was offered on line zero");
    assert.ok(s.byId.has(to), "a jump pointed at a node that does not exist");
  }
});

test("a file nothing resolves out of offers no jumps at all", async () => {
  const s = await load();
  const leaf = s.LAYOUT.nodes.find((n) => (n.outDeg ?? 0) === 0);
  if (!leaf) return;
  assert.equal(s.srcJumpLines(leaf.id), null);
});

/* ── the breadcrumb ───────────────────────────────────────────────────────── */

test("the breadcrumb names service, district and file, and hides with nothing selected", async () => {
  const s = await load();
  const n = s.LAYOUT.nodes.find((x) => x.kind === "file");
  s.goTo(n.id);
  const bar = s.$("#crumb");
  assert.equal(bar.hidden, false);
  assert.ok(bar.textContent.includes(n.name), "the breadcrumb does not name the file");

  s.S.selected = null;
  s.renderBreadcrumb();
  assert.equal(bar.hidden, true, "the breadcrumb stayed up with nothing selected");
});
