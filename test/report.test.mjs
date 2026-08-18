/**
 * What the CLI says while it works.
 *
 * `atlas scan` is the command a stranger runs when the map looks wrong, so its
 * report has to account for every node it drew — a histogram that quietly drops
 * a column is worse than no histogram, because it reads as a clean bill.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../src/cli/report.mjs";
import { makeProgress } from "../src/cli/progress.mjs";
import { scanFixture } from "./helpers.mjs";

/** Run diagnose against a sink instead of stdout. */
function lines(payload, diagnostics) {
  const out = [];
  diagnose(payload, diagnostics, (...m) => out.push(m.join(" ")));
  return out;
}

test("the histograms account for every node", async () => {
  const { payload, diagnostics } = await scanFixture("mini-monorepo");
  const out = lines(payload, diagnostics);

  for (const [title, key] of [["layers", "layer"], ["services", "service"]]) {
    const start = out.findIndex((l) => l.startsWith(`atlas: ${title} in use=`));
    assert.ok(start >= 0, `no ${title} histogram`);
    let total = 0;
    for (const l of out.slice(start + 1)) {
      const m = l.match(/^ +(\d+) (\S+)$/);
      if (!m) break;
      total += Number(m[1]);
      assert.ok(
        payload.nodes.some((n) => n[key] === m[2]),
        `${title} histogram names ${m[2]}, which no node uses`,
      );
    }
    assert.equal(total, payload.nodes.length, `${title} histogram does not sum to nodeCount`);
  }
});

test("a layer no file landed in is counted but not listed", async () => {
  const { payload, diagnostics } = await scanFixture("mini-monorepo");
  const out = lines(payload, diagnostics);
  const used = new Set(payload.nodes.map((n) => n.layer));

  const header = out.find((l) => l.startsWith("atlas: layers in use="));
  assert.equal(header, `atlas: layers in use=${used.size}/${payload.layers.length}`);
  assert.ok(used.size < payload.layers.length, "fixture no longer exercises an empty layer");
});

test("unresolved specifiers are grouped by specifier, worst first", async () => {
  const { payload, diagnostics } = await scanFixture("mini-monorepo");
  // The fixtures resolve cleanly on purpose, so the branch is driven directly
  // rather than by breaking a fixture — which would move the goldens.
  const unresolvedSpecs = [
    { from: "a.ts", spec: "@/lib/auth" },
    { from: "b.ts", spec: "@/lib/auth" },
    { from: "c.ts", spec: "./missing" },
  ];
  const out = lines(payload, { ...diagnostics, stats: { ...diagnostics.stats, unresolvedSpecs } });

  const start = out.findIndex((l) => l.startsWith("atlas: unresolved specifiers"));
  assert.ok(start >= 0);
  assert.match(out[start + 1], /2 × @\/lib\/auth$/);
  assert.match(out[start + 2], /1 × \.\/missing$/);
});

test("a clean scan says nothing about unresolved specifiers", async () => {
  const { payload, diagnostics } = await scanFixture("mini-monorepo");
  assert.equal(diagnostics.stats.unresolved, 0);
  assert.ok(!lines(payload, diagnostics).some((l) => l.includes("unresolved specifiers")));
});

/** A stream that records instead of drawing, plus a clock the test drives. */
function fakeTTY(isTTY = true) {
  const writes = [];
  let t = 0;
  return { stream: { isTTY, write: (s) => writes.push(s) }, writes, tick: (ms) => (t += ms), now: () => t };
}

test("progress writes nothing at all when the stream is not a terminal", () => {
  // This is what keeps `--json | jq` and every redirect clean: the guarantee is
  // "no bytes", not "bytes the consumer is expected to filter".
  const f = fakeTTY(false);
  const p = makeProgress(f.stream, f.now);
  for (let i = 0; i < 500; i++) {
    f.tick(1000);
    p("parse", `${i}/500`);
  }
  p.clear();
  p.done();
  assert.deepEqual(f.writes, []);
});

test("progress is throttled to about ten writes a second", () => {
  const f = fakeTTY();
  const p = makeProgress(f.stream, f.now);
  for (let i = 0; i < 100; i++) p("parse", `${i}/100`);   // all inside one window
  assert.equal(f.writes.length, 1);

  f.tick(100);
  p("parse", "100/100");
  assert.equal(f.writes.length, 2);
});

test("entering a phase draws even inside the throttle window", () => {
  // Otherwise the line can read `parse 12000/40000` while the scan is really
  // three phases further on, which answers "is it hung?" wrongly.
  const f = fakeTTY();
  const p = makeProgress(f.stream, f.now);
  p("parse", "1/2");
  p("parse", "2/2");
  p("resolve");
  assert.equal(f.writes.length, 2);
  assert.match(f.writes.at(-1), /parse 2\/2 · resolve$/);
});

test("the line accumulates phases in the order they happened", () => {
  const f = fakeTTY();
  const p = makeProgress(f.stream, f.now);
  for (const [phase, detail] of [["walk", "8 files"], ["parse", "8/8"], ["resolve", ""], ["endpoints", "5"]]) {
    f.tick(100);
    p(phase, detail);
  }
  assert.match(f.writes.at(-1), /walk 8 files · parse 8\/8 · resolve · endpoints 5$/);
});

test("progress leaves the line clear for whatever prints next", () => {
  const f = fakeTTY();
  const p = makeProgress(f.stream, f.now);
  f.tick(100);
  p("walk", "8 files");
  p.done();
  assert.equal(f.writes.at(-1), "\r\x1b[K");
});
