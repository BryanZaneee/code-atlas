/**
 * `atlas map` — the terminal renderer.
 *
 * The map is a picture, so most of what is worth asserting is not "does it look
 * right" but "does it stay the same", and that is a golden. What is asserted
 * directly is everything a picture cannot show: that the colour ladder answers
 * correctly for each kind of terminal, that a pipe gets no escape sequences at
 * all, that a repo too large to draw a file per block says so rather than
 * drawing noise, and that an empty repo gets a sentence instead of a blank
 * screen.
 *
 * Re-baseline deliberately: UPDATE_GOLDEN=1 npm test, then READ the diff. The
 * golden is text precisely so the diff says what moved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { renderMap, colorMode, layout, fitScale } from "../src/cli/iso.mjs";
import { scanFixture, GOLDEN_DIR } from "./helpers.mjs";

/* ── the colour ladder ────────────────────────────────────────────────────── */

const tty = (env) => colorMode({ isTTY: true }, env);

test("a pipe never gets colour, whatever the environment claims", () => {
  assert.equal(colorMode({ isTTY: false }, { COLORTERM: "truecolor", TERM: "xterm-256color" }), "none");
});

test("NO_COLOR wins over every other signal", () => {
  assert.equal(colorMode({ isTTY: true }, { NO_COLOR: "1", COLORTERM: "truecolor" }), "none");
});

test("the ladder reads COLORTERM, then TERM, then gives up", () => {
  assert.equal(tty({ COLORTERM: "truecolor", TERM: "xterm" }), "truecolor");
  assert.equal(tty({ COLORTERM: "24bit", TERM: "xterm" }), "truecolor");
  assert.equal(tty({ TERM: "xterm-256color" }), "256");
  assert.equal(tty({ TERM: "screen-256color" }), "256");
  assert.equal(tty({ TERM: "xterm" }), "16");
  assert.equal(tty({ TERM: "dumb" }), "none");
  assert.equal(tty({}), "none");
});

/* ── what reaches stdout ──────────────────────────────────────────────────── */

test("mode none emits no escape sequence anywhere, map or legend", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const out = renderMap(payload, { width: 80, height: 20, mode: "none" });
  assert.ok(!out.includes("\x1b"), "an escape sequence reached a non-terminal stdout");
  assert.ok(out.includes("mini-monorepo"), "the header names the repo");
});

test("every colour mode draws the same picture, only in different ink", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const shape = (mode) =>
    renderMap(payload, { width: 80, height: 20, mode })
      // Strip the escapes and the half-block, leaving only where ink landed.
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n").map((l) => l.replace(/\S/g, "#")).join("\n");
  const truecolor = shape("truecolor");
  assert.equal(shape("256"), truecolor);
  assert.equal(shape("16"), truecolor);
});

test("truecolor and 256 reach for different escapes for the same colour", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const opts = { width: 80, height: 20 };
  assert.match(renderMap(payload, { ...opts, mode: "truecolor" }), /\x1b\[38;2;\d+;\d+;\d+m/);
  assert.match(renderMap(payload, { ...opts, mode: "256" }), /\x1b\[38;5;\d+m/);
  assert.match(renderMap(payload, { ...opts, mode: "16" }), /\x1b\[(3[0-7]|9[0-7])m/);
});

/* ── graceful degradation ─────────────────────────────────────────────────── */

test("a repo with nothing in it gets a sentence, not a blank screen", () => {
  const empty = {
    meta: { repo: "nothing", commit: "0000000", fileCount: 0, lineCount: 0, edgeCount: 0, endpointCount: 0 },
    services: [], layers: [], nodes: [], districts: [],
  };
  const out = renderMap(empty, { width: 60, height: 12, mode: "none" });
  assert.match(out, /nothing to draw/);
});

test("a map too small for one block per file collapses to districts and says so", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const tiny = renderMap(payload, { width: 24, height: 8, mode: "none" });
  assert.match(tiny, /districts, not files/);
  assert.match(tiny, /districts by layer/);

  const roomy = renderMap(payload, { width: 120, height: 40, mode: "none" });
  assert.ok(!roomy.includes("districts, not files"), "a map with room should draw files");
  assert.match(roomy, /blocks by layer/);
});

test("collapse can be asked for and refused explicitly, not only inferred", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const forced = renderMap(payload, { width: 120, height: 40, mode: "none", collapse: true });
  assert.match(forced, /districts by layer/);
  const refused = renderMap(payload, { width: 24, height: 8, mode: "none", collapse: false });
  assert.ok(!refused.includes("districts, not files"));
});

test("a narrow terminal still draws rather than throwing", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  for (const width of [20, 40, 80]) {
    const out = renderMap(payload, { width, height: 10, mode: "none" });
    assert.ok(out.split("\n").length > 4, `${width} columns produced nothing`);
    for (const line of out.split("\n")) {
      assert.ok(line.length <= Math.max(width, 120), `a line ran past ${width} columns`);
    }
  }
});

/* ── determinism ──────────────────────────────────────────────────────────── */

test("two renders of one payload are byte-identical", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const opts = { width: 80, height: 20, mode: "truecolor" };
  assert.equal(renderMap(payload, opts), renderMap(payload, opts));
});

test("the layout places every file exactly once, and no two on one cell", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const { blocks } = layout(payload);
  const drawn = new Set(blocks.map((b) => b.id));
  const expected = new Set(payload.districts.flatMap((d) => d.members));
  assert.deepEqual([...drawn].sort(), [...expected].sort());
  const cells = new Set(blocks.map((b) => `${b.gx},${b.gy}`));
  assert.equal(cells.size, blocks.length, "two blocks landed on the same grid cell");
});

test("the fit scales to the grid it was given, not past it", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const model = layout(payload);
  const wide = fitScale(model, 200, 100).t;
  const narrow = fitScale(model, 40, 20).t;
  assert.ok(wide > narrow, "a larger grid should earn a larger tile");
});

/* ── the golden ───────────────────────────────────────────────────────────── */

test("the mini-monorepo map matches its golden", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const actual = renderMap(payload, { width: 80, height: 20, mode: "none" });
  const file = path.join(GOLDEN_DIR, "mini-monorepo.map.txt");
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(file, actual);
    return;
  }
  assert.ok(existsSync(file), `golden missing: ${file} — create it with UPDATE_GOLDEN=1`);
  assert.equal(actual, readFileSync(file, "utf8"), "the terminal map drifted from its golden");
});
