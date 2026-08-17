/**
 * Shared test helpers. Stdlib only — see CLAUDE.md.
 *
 * The golden files under test/golden/ are the regression backbone: a phase that
 * legitimately changes the payload re-baselines them in the same commit, and the
 * diff is the review artifact. Re-baseline with UPDATE_GOLDEN=1 npm test, then
 * read the diff before committing it.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scan } from "../src/build/build.mjs";

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(TEST_DIR, "..");
export const GOLDEN_DIR = path.join(TEST_DIR, "golden");
export const FIXTURE_DIR = path.join(REPO_ROOT, "fixtures");

/** meta.generatedAt is the one field allowed to vary between runs of the same input. */
export function normalize(payload) {
  const p = structuredClone(payload);
  if (p?.meta) p.meta.generatedAt = null;
  return p;
}

/** The on-disk form of a golden: normalized, pretty, newline-terminated. */
export const serialize = (payload) => JSON.stringify(normalize(payload), null, 2) + "\n";

/**
 * Compare a payload against its golden, or rewrite it under UPDATE_GOLDEN=1.
 * Returns { ok, expected, actual } so the caller owns the assertion message.
 */
export function checkGolden(name, payload) {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const actual = serialize(payload);
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, actual);
    return { ok: true, updated: true, file };
  }
  if (!existsSync(file)) return { ok: false, missing: true, file, actual };
  const expected = readFileSync(file, "utf8");
  return { ok: expected === actual, file, expected, actual };
}

/** First line that differs, so a 234 KB mismatch reports somewhere useful. */
export function firstDiff(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1}:\n  expected: ${a[i] ?? "<eof>"}\n  actual:   ${b[i] ?? "<eof>"}`;
  }
  return "files differ only in length";
}

/**
 * The validation corpus lives outside this repo and drifts, so every target is
 * optional: tests that use one skip when it is absent. `npm test` stays green on
 * a fresh clone; the real-repo gates run wherever the repos exist.
 */
const CORPUS = {
  taxvault: "../FedStack/daring-devs-tax-vault",
  shuttrr: "../Shuttrr",
  terra: "../terra",
  sonder: "../sonder",
  llmbench: "../llmbench",
};

/**
 * Scan an in-repo fixture through the fs rung — no git, so CI needs none.
 *
 * A fixture without an `atlas.config.mjs` is scanned with none, which is not an
 * oversight: the no-config path is the one a stranger's repository takes, so it
 * needs a target CI enforces.
 */
export async function scanFixture(name, opts = {}) {
  const repo = path.join(FIXTURE_DIR, name);
  const configPath = path.join(repo, "atlas.config.mjs");
  const config = existsSync(configPath)
    ? (await import(pathToFileURL(configPath).href)).default
    : undefined;
  return scan({ repo, ref: "fs", config, ...opts });
}

export function corpusRepo(name) {
  const override = process.env[`ATLAS_TARGET_${name.toUpperCase()}`];
  const dir = path.resolve(REPO_ROOT, override ?? CORPUS[name] ?? "");
  return existsSync(dir) ? dir : null;
}
