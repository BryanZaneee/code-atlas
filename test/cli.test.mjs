/**
 * `atlas init` — the only command that writes to a target repository.
 *
 * Spawned rather than imported, because what is worth protecting here is not the
 * template: it is that a second run cannot destroy a config somebody edited by
 * hand, and that guard lives in the CLI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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



/** Run the CLI expecting it to refuse: returns `{status, stderr}`. */
function atlasFails(args) {
  try {
    atlas(args);
    return null;                       // it did not fail, which is the failure
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr ?? "") };
  }
}

/**
 * Live mode's flags fail early and loudly.
 *
 * Each of these could plausibly have been a warning that still started a
 * server, and each would have been worse for it: a LIVE toggle permanently
 * disabled after you asked for it, or every request going out unauthenticated
 * after you said you had a token. The scan has not run yet at this point
 * either, so a typo costs a message rather than a walk of the repository.
 */
test("live flags are validated before anything else happens", (t) => {
  const dir = tmpRepo(t, "flat-app");

  const noTarget = atlasFails(["serve", "--repo", dir, "--allow-live"]);
  assert.ok(noTarget, "--allow-live without --target should not start a server");
  assert.match(noTarget.stderr, /--allow-live needs --target/);

  const publicTarget = atlasFails(["serve", "--repo", dir, "--allow-live", "--target", "http://example.com"]);
  assert.ok(publicTarget, "a public target should not start a server");
  assert.match(publicTarget.stderr, /not a loopback or private/);

  // Link-local is the cloud metadata range. It reads as private and is not.
  const metadata = atlasFails(["serve", "--repo", dir, "--allow-live", "--target", "http://169.254.169.254"]);
  assert.ok(metadata, "the metadata address should not start a server");
  assert.match(metadata.stderr, /not a loopback or private/);

  const noEnv = atlasFails([
    "serve", "--repo", dir, "--allow-live",
    "--target", "http://127.0.0.1:3000", "--auth-env", "ATLAS_TEST_UNSET_VAR",
  ]);
  assert.ok(noEnv, "an unset auth variable should not start a server");
  assert.match(noEnv.stderr, /ATLAS_TEST_UNSET_VAR is not set/);
});

test("live flags on a command that cannot use them warn rather than fail", (t) => {
  const dir = tmpRepo(t, "flat-app");
  // execFileSync only hands back stderr when the command fails, so this runs
  // through spawnSync to read the warning AND prove the build still succeeded.
  const r = spawnSync(process.execPath, [
    ATLAS, "build", "--repo", dir, "--ref", "fs", "--json",
    "--allow-live", "--target", "http://127.0.0.1:3000",
  ], { encoding: "utf8" });

  assert.equal(r.status, 0, "a misplaced live flag must not fail the build");
  assert.match(r.stderr, /only applies to serve/);
  assert.ok(JSON.parse(r.stdout).nodes.length, "and the payload is still produced");
});

