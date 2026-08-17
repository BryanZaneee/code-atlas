/**
 * The tool must know nothing about any specific repository.
 *
 * taxvault, Shuttrr, terra, sonder and llmbench are a validation corpus, not
 * fixtures: they prove the visualization and the data flow hold up on real code.
 * When one of their gates fails the fix belongs in config or detection, never in
 * a branch here. This catches the paste that makes one repo work.
 *
 * It only catches *named* strings. A rule quietly shaped around one repo's
 * directory layout passes this and is still wrong — the review question stays
 * "would this be right on a repo I have never seen?"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./helpers.mjs";

const BANNED = [
  "taxvault", "tax_vault", "tax-vault", "shuttrr", "llmbench", "terra",
  "sonder", "engagement", "drizzle", "prompt-journal", "apps/api",
  "ingestion-ocr", "identity-auth", "vitest.integration", "AGENTS.md",
];

function* sourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory not created yet
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* sourceFiles(full);
    else if (statSync(full).isFile()) yield full;
  }
}

/**
 * Phase 1 emptied this. It exists so a violation that cannot be fixed inside
 * the phase that introduces it is recorded rather than ignored, and so that
 * fixing one forces deleting its entry. Adding to it needs a reason and a
 * named phase that removes it.
 */
const ACCEPTED = new Set([]);

function scanForBanned() {
  const hits = [];
  for (const root of ["src", "bin"]) {
    for (const file of sourceFiles(path.join(REPO_ROOT, root))) {
      const rel = path.relative(REPO_ROOT, file);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const lower = line.toLowerCase();
        for (const word of BANNED) {
          if (lower.includes(word.toLowerCase())) {
            hits.push({ key: `${rel}:${word}`, where: `${rel}:${i + 1}`, word, line: line.trim().slice(0, 80) });
          }
        }
      });
    }
  }
  return hits;
}

test("src/ and bin/ contain no target-specific strings", () => {
  const unexpected = scanForBanned().filter((h) => !ACCEPTED.has(h.key));
  assert.deepEqual(
    unexpected.map((h) => `${h.where}  ${h.word}  ${h.line}`),
    [],
    "target-specific strings belong in config, not in the tool",
  );
});

test("the accepted-violation list has no stale entries", () => {
  const present = new Set(scanForBanned().map((h) => h.key));
  const stale = [...ACCEPTED].filter((k) => !present.has(k));
  assert.deepEqual(stale, [], "these were fixed — delete them from ACCEPTED");
});
