/**
 * `atlas init` — the only command that writes to a target repository.
 *
 * Spawned rather than imported, because what is worth protecting here is not the
 * template: it is that a second run cannot destroy a config somebody edited by
 * hand, and that guard lives in the CLI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/config/load.mjs";
import { REPO_ROOT, tmpRepo } from "./helpers.mjs";

const ATLAS = path.join(REPO_ROOT, "bin", "atlas.mjs");

const atlas = (args, opts = {}) =>
  execFileSync(process.execPath, [ATLAS, ...args], { encoding: "utf8", stdio: "pipe", ...opts });

test("init writes a config the loader accepts, naming what it detected", async (t) => {
  const dir = tmpRepo(t, "flat-app");
  atlas(["init", "--repo", dir]);
  const file = path.join(dir, "atlas.config.mjs");
  assert.ok(existsSync(file));

  const user = (await import(pathToFileURL(file).href)).default;
  const config = loadConfig(user);
  // The point of emitting detection rather than a skeleton: you cannot correct
  // a list you have never seen.
  assert.deepEqual(config.services.map((s) => s.id), ["flat-app"]);
  assert.equal(config.services[0].root, null);
  // Everything the config does not name still comes from the defaults.
  assert.ok(config.layers.length > 1);
  assert.equal(typeof config.layerOf, "function");
  assert.equal(config.layerOf("src/routes/items.ts").layer, "route");
});

test("init refuses to overwrite a config that already exists", (t) => {
  const dir = tmpRepo(t, "flat-app");
  const file = path.join(dir, "atlas.config.mjs");
  {
    atlas(["init", "--repo", dir]);
    const written = readFileSync(file, "utf8");

    assert.throws(
      () => atlas(["init", "--repo", dir]),
      (e) => e.status === 1 && /already exists/.test(e.stderr),
    );
    assert.equal(readFileSync(file, "utf8"), written, "init overwrote an existing config");
  }
});

test("--json survives a pipe, whole", (t) => {
  // process.stdout is asynchronous when it is a pipe, so exiting after the
  // write discarded everything past the 64 KB pipe buffer — a payload that
  // parsed fine redirected to a file and truncated mid-string when piped.
  // execFileSync gives us a pipe, which is exactly the failing case; the repo
  // has to out-produce the buffer or the test proves nothing, so it is
  // generated rather than borrowed from a corpus that may not be checked out.
  const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-big-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  {
    for (let i = 0; i < 400; i++) {
      writeFileSync(path.join(dir, `mod${i}.ts`), `import { a } from "./mod${(i + 1) % 400}.js";\nexport const a = ${i};\n`);
    }
    const out = atlas(["build", "--repo", dir, "--ref", "fs", "--json"], { maxBuffer: 64 * 1024 * 1024 });
    assert.ok(out.length > 65536, `payload is ${out.length}B — too small to prove anything`);
    const payload = JSON.parse(out);
    assert.equal(payload.nodes.length, payload.meta.nodeCount);
  }
});

test("a repository built with its own generated config still renders", (t) => {
  const dir = tmpRepo(t, "flat-app");
  atlas(["init", "--repo", dir]);
  const out = atlas([
    "build", "--repo", dir, "--config", path.join(dir, "atlas.config.mjs"),
    "--ref", "fs", "--json",
  ]);
  const payload = JSON.parse(out);
  assert.ok(payload.meta.nodeCount > 0);
  const declared = new Set(payload.services.map((s) => s.id));
  for (const n of payload.nodes) assert.ok(declared.has(n.service), `${n.id} has a stranded service`);
});
