/**
 * The Phase 2 gate: `atlas build` with NO CONFIG AT ALL yields a legible atlas
 * for every repository in the validation corpus.
 *
 * These are a corpus, not fixtures. They exist to prove the visualization holds
 * up on real, messy code — a monorepo, a Tauri app, a Next.js app, a Python
 * package with only a pyproject, and a git repository with zero commits. None of
 * them is ever encoded into `src/`: when one of these fails, the fix belongs in
 * the defaults or in detection, never in a special case.
 *
 * They live outside this repository and drift, so each one skips when absent.
 * `npm test` stays green on a fresh clone and in CI; the real-repo gates run
 * wherever the repos exist. Point them somewhere else with
 * ATLAS_TARGET_SHUTTRR=/path/to/repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/build/build.mjs";
import { corpusRepo } from "./helpers.mjs";

const TARGETS = ["taxvault", "shuttrr", "terra", "sonder", "llmbench"];

/** No config, and no ref: exactly what a stranger's first run looks like. */
const scanBare = (repo) => scan({ repo, config: undefined, fetch: false, warn: () => {} }).payload;

for (const name of TARGETS) {
  test(`${name}: no config yields a legible atlas`, (t) => {
    const repo = corpusRepo(name);
    if (!repo) return t.skip(`${name} not present — the corpus lives outside this repo`);

    const p = scanBare(repo);

    // Something to look at at all. A blank screen is the prototype's #1
    // documented failure mode and every assertion below is a way of missing it.
    assert.ok(p.meta.nodeCount > 0, "no nodes");
    assert.ok(p.meta.fileCount > 0, "no code files — check the keep pattern");
    assert.ok(p.services.length >= 1, "no services");
    assert.ok(p.layers.length >= 1, "no layers");

    // Failure mode #1: the viewer filters by service, so a node whose service is
    // not in the list is invisible with no checkbox to bring it back.
    const services = new Set(p.services.map((s) => s.id));
    const stranded = [...new Set(p.nodes.filter((n) => !services.has(n.service)).map((n) => n.service))];
    assert.deepEqual(stranded, [], "these services are used but not declared");

    // Same for layers, which are the columns.
    const layers = new Set(p.layers.map((l) => l.id));
    const unplaced = [...new Set(p.nodes.filter((n) => !layers.has(n.layer)).map((n) => n.layer))];
    assert.deepEqual(unplaced, [], "these layers are used but not declared");

    // Failure mode #2: no coverage tooling in the loop, so "none" is a claim
    // about the repo. It may only be made where a test actually reaches
    // something; otherwise every file reads null.
    if (p.meta.testCount === 0) {
      assert.equal(p.meta.coverNone, 0, "a repo with no tests must not report files as untested");
    }

    // Provenance is what makes a wrong answer fixable instead of mysterious.
    for (const n of p.nodes.filter((x) => x.kind === "file")) {
      assert.ok(n.layerWhy && n.serviceWhy, `${n.id} arrived with no reason`);
    }
  });

  /**
   * Failure mode #4, quantified rather than assumed. The tool is allowed not to
   * recognise a layout — it is not allowed to be silently useless, and one
   * column of everything is what that looks like. The threshold is deliberately
   * loose: this is a smoke alarm, not a quality score.
   */
  test(`${name}: the map is more than one column`, (t) => {
    const repo = corpusRepo(name);
    if (!repo) return t.skip(`${name} not present`);

    const p = scanBare(repo);
    const files = p.nodes.filter((n) => n.kind === "file");
    const byLayer = new Map();
    for (const n of files) byLayer.set(n.layer, (byLayer.get(n.layer) ?? 0) + 1);

    assert.ok(byLayer.size >= 3, `only ${byLayer.size} layer(s) in use: ${[...byLayer.keys()]}`);
    const unsorted = byLayer.get("unsorted") ?? 0;
    assert.ok(
      unsorted / files.length < 0.6,
      `${Math.round((unsorted / files.length) * 100)}% of files matched no rule — the defaults are not carrying this layout`,
    );
  });
}

/**
 * Determinism, on real input. The in-repo fixtures assert this too, but they are
 * small and tidy; a repo with thousands of files and several languages is where
 * an accidental Set iteration or an unsorted readdir would actually show up.
 */
test("scanning the same real repo twice is byte-identical", (t) => {
  const repo = corpusRepo("shuttrr") ?? corpusRepo("taxvault");
  if (!repo) return t.skip("no corpus repo present");

  const strip = (p) => JSON.stringify({ ...p, meta: { ...p.meta, generatedAt: null } });
  assert.equal(strip(scanBare(repo)), strip(scanBare(repo)));
});
