/**
 * `--embed-source [glob]` / `--gzip-source` at the scan and CLI layers.
 *
 * The viewer-side reading of `payload.source` (cache, decompression, the
 * three-state badge, jump-to-line without a server) is covered in
 * test/source.test.mjs; this file covers what produces that field: `scan()`'s
 * `embedSourceFiles()` call, determinism, the CLI's optional-value flag
 * parsing, and the gzip size-cut gate from ROADMAP.md Phase 7.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { scan } from "../src/build/build.mjs";
import { collect } from "../src/scan/walk.mjs";
import { loadConfig } from "../src/config/load.mjs";
import { REPO_ROOT, FIXTURE_DIR, scanFixture, serialize } from "./helpers.mjs";

const ATLAS = path.join(REPO_ROOT, "bin", "atlas.mjs");
const atlas = (args, opts = {}) =>
  execFileSync(process.execPath, [ATLAS, ...args], { encoding: "utf8", stdio: "pipe", ...opts });

test("neither flag: the payload carries no `source` field at all", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  assert.equal("source" in payload, false);
});

test("--embed-source embeds the whole scanned set, verbatim, from the same set atlas serve allowlists", async () => {
  const { payload } = await scanFixture("mini-monorepo", { embedSource: true });
  assert.ok(payload.source);
  assert.equal(payload.source.glob, null);
  assert.equal(payload.source.gzip, false);

  const repo = path.join(FIXTURE_DIR, "mini-monorepo");
  const config = (await import(pathToFileURL(path.join(repo, "atlas.config.mjs")).href)).default;
  const { keep, exclude } = loadConfig(config);
  const { paths, src } = collect(repo, { keep, exclude });

  assert.deepEqual(Object.keys(payload.source.files), paths, "embedded key order must follow collect()'s sorted paths");
  for (const p of paths) assert.equal(payload.source.files[p], src.get(p));
});

test("--embed-source [glob] narrows the embedded set to files the glob matches, and only those", async () => {
  const { payload } = await scanFixture("mini-monorepo", {
    embedSource: true,
    embedGlob: "services/api/**/*.ts",
  });
  const keys = Object.keys(payload.source.files);
  assert.ok(keys.length > 0, "the glob must match something in this fixture");
  for (const k of keys) assert.ok(k.startsWith("services/api/") && k.endsWith(".ts"), k);
  assert.equal(payload.source.glob, "services/api/**/*.ts");
});

test("--gzip-source round-trips to exactly the text --embed-source alone stores", async () => {
  const [plain, gz] = await Promise.all([
    scanFixture("mini-monorepo", { embedSource: true }),
    scanFixture("mini-monorepo", { embedSource: true, gzipSource: true }),
  ]);
  assert.equal(gz.payload.source.gzip, true);
  assert.equal("files" in gz.payload.source, false, "gzip=true stores the shared blob, not a files map");
  assert.deepEqual(gz.payload.source.paths, plain.payload.source.paths);

  // One shared gzip stream over every file's text together — decoded once,
  // the same way the viewer does it.
  const decoded = JSON.parse(zlib.gunzipSync(Buffer.from(gz.payload.source.blob, "base64")).toString("utf8"));
  assert.deepEqual(decoded, plain.payload.source.files);
});

test("embedding is deterministic — two runs of the same input are byte-identical", async () => {
  const [a, b] = await Promise.all([
    scanFixture("mini-monorepo", { embedSource: true, gzipSource: true }),
    scanFixture("mini-monorepo", { embedSource: true, gzipSource: true }),
  ]);
  assert.equal(serialize(a.payload), serialize(b.payload));
});

/**
 * A repo generated rather than borrowed from a corpus that may not be checked
 * out — same reasoning cli.test.mjs's big-payload test uses. Content repeats
 * across files the way a scaffolded app's routes or handlers do, which is
 * exactly the redundancy a single shared gzip blob is built to exploit — see
 * `embed.mjs`'s note on why one blob beats one gzip stream per file.
 */
function repetitiveRepo(t, fileCount = 150) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-embed-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const body = `import { helper } from "./helper.js";\n\nexport function run(value) {\n  // a representative line of application code, repeated\n  return helper(value, value, value);\n}\n`;
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(path.join(dir, `mod${i}.ts`), body.repeat(30));
  }
  return dir;
}

/**
 * What --gzip-source is actually worth, measured on real code.
 *
 * This asserted >=3x against a generated repo of near-identical files, where it
 * scored 154x. That number said nothing: a fixture built to compress well
 * compresses well. ROADMAP.md's >=3x is DEFERRED, not met, and the reason is
 * arithmetic rather than implementation — gzip gets ~3.1x on this repository's
 * own source, and base64 then multiplies the result by 4/3 to survive JSON, so
 * the artifact lands near 2.3x. Even a zero-overhead encoding could not reach
 * 3x here, which is why no amount of tuning was spent trying.
 *
 * So this measures THIS repository — real, mixed, non-repetitive source that is
 * always present — and holds a floor the mechanism genuinely clears. If the
 * floor ever breaks, gzip has stopped earning the async boot step it costs, and
 * the honest response is to delete the flag rather than lower the bar again.
 */
test("--gzip-source earns its cost on real source, not on a friendly fixture", () => {
  const plain = scan({ repo: REPO_ROOT, ref: "fs", embedSource: true });
  const gz = scan({ repo: REPO_ROOT, ref: "fs", embedSource: true, gzipSource: true });

  const plainBytes = Buffer.byteLength(JSON.stringify(plain.payload.source.files), "utf8");
  const gzBytes = Buffer.byteLength(gz.payload.source.blob, "utf8");
  const ratio = plainBytes / gzBytes;

  assert.ok(ratio >= 2, `gzip no longer pays for itself: ${ratio.toFixed(2)}x (${plainBytes}B -> ${gzBytes}B)`);
  assert.ok(ratio < 3, `it now clears ROADMAP's deferred >=3x at ${ratio.toFixed(2)}x — re-open that gate rather than leaving this comment stale`);
});

test("CLI: --embed-source (bare), --embed-source=glob, and --embed-source glob are all accepted", (t) => {
  const dir = repetitiveRepo(t, 5);

  const bare = JSON.parse(atlas(["build", "--repo", dir, "--ref", "fs", "--json", "--embed-source"]));
  assert.equal(bare.source.glob, null);
  assert.equal(Object.keys(bare.source.files).length, 5);

  const eq = JSON.parse(atlas(["build", "--repo", dir, "--ref", "fs", "--json", "--embed-source=mod0.ts"]));
  assert.deepEqual(Object.keys(eq.source.files), ["mod0.ts"]);

  const sp = JSON.parse(atlas(["build", "--repo", dir, "--ref", "fs", "--json", "--embed-source", "mod1.ts"]));
  assert.deepEqual(Object.keys(sp.source.files), ["mod1.ts"]);
});

test("CLI: a bare --embed-source directly followed by another flag does not swallow that flag as its glob", (t) => {
  const dir = repetitiveRepo(t, 3);
  const out = JSON.parse(atlas(["build", "--repo", dir, "--embed-source", "--ref", "fs", "--json"]));
  assert.equal(out.source.glob, null, "the whole set, not \"--ref\" mistaken for a glob");
  assert.equal(Object.keys(out.source.files).length, 3);
  assert.equal(out.meta.fileCount, 3, "--ref fs must still have been parsed as fs acquisition");
});

test("CLI: build prints a plain-language size warning naming file count and glob", (t) => {
  const dir = repetitiveRepo(t, 5);
  const outFile = path.join(dir, "out.html");
  // `build`'s commentary is stderr (CLAUDE.md: stdout is a command's output,
  // stderr its commentary), and execFileSync's return value is stdout only —
  // spawnSync is what hands back both streams regardless of exit code.
  const r = spawnSync(
    process.execPath,
    [ATLAS, "build", "--repo", dir, "--ref", "fs", "--out", outFile, "--embed-source"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /--embed-source added \d+ KB/);
  assert.match(r.stderr, /5 file\(s\)/);
  assert.match(r.stderr, /rebuild with --gzip-source/);
});

test("CLI: --gzip-source without --embed-source warns and has no effect", (t) => {
  const dir = repetitiveRepo(t, 3);
  const outFile = path.join(dir, "out.html");
  const r = spawnSync(
    process.execPath,
    [ATLAS, "build", "--repo", dir, "--ref", "fs", "--out", outFile, "--gzip-source"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /--gzip-source has no effect without --embed-source/);
});

test("CLI: a built, embedded atlas.html actually carries the source text", (t) => {
  const dir = repetitiveRepo(t, 2);
  const outFile = path.join(dir, "out.html");
  atlas(["build", "--repo", dir, "--ref", "fs", "--out", outFile, "--embed-source"]);
  const html = readFileSync(outFile, "utf8");
  assert.ok(html.includes("mod0.ts"));
  assert.ok(html.includes("helper(value, value, value)"));
});
