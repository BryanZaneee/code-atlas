/**
 * What the CLI says while it works.
 *
 * `atlas scan` is the command a stranger runs when the map looks wrong, so its
 * report has to account for every node it drew — a histogram that quietly drops
 * a column is worse than no histogram, because it reads as a clean bill.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../src/build/build.mjs";
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
