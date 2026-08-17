/**
 * The acquisition ladder.
 *
 * Every rung is read-only on the target: no branch is switched and no file is
 * modified. The rungs below `ref` exist because two ordinary states used to be
 * fatal — a directory that is not a git repository, and a git repository with no
 * commits yet, where `rev-parse --git-dir` succeeds while `rev-parse HEAD`
 * fails. Both are what a repo somebody started this morning looks like.
 *
 * The repositories here are built in a temp directory rather than checked in:
 * a git repository inside a git repository is not something to commit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquire } from "../src/scan/source.mjs";

/** A throwaway directory with one source file, optionally a git repository. */
function makeRepo({ git = false, commit = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-test-"));
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "server.ts"), "export const app = 1;\n");
  if (git) {
    const run = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    run("init", "-q");
    run("config", "user.email", "test@example.invalid");
    run("config", "user.name", "test");
    if (commit) {
      run("add", "-A");
      run("commit", "-qm", "initial");
    }
  }
  return dir;
}

test("a plain directory is scanned as it sits", () => {
  const dir = makeRepo();
  try {
    const s = acquire({ repo: dir, ref: "fs" });
    assert.equal(s.acquisition.mode, "fs");
    // Unknowable, not false: without git there is nothing to be dirty against.
    assert.equal(s.acquisition.dirty, null);
    assert.equal(s.dir, dir);
    s.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory that is not a git repository falls to the fs rung", () => {
  const dir = makeRepo();
  const warnings = [];
  try {
    const s = acquire({ repo: dir, warn: (m) => warnings.push(m) });
    assert.equal(s.acquisition.mode, "fs");
    assert.match(warnings.join("\n"), /not a git repository/);
    s.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * PLAN.md failure mode #5. `git init` with nothing committed used to exit(1),
 * which meant the tool refused the repositories most likely to want a map.
 */
test("a git repository with no commits falls to the worktree rung", () => {
  const dir = makeRepo({ git: true });
  const warnings = [];
  try {
    const s = acquire({ repo: dir, warn: (m) => warnings.push(m) });
    assert.equal(s.acquisition.mode, "worktree");
    assert.equal(s.acquisition.commit, null);
    // Nothing is committed, so everything in the tree is uncommitted work.
    assert.equal(s.acquisition.dirty, true);
    assert.match(warnings.join("\n"), /no commits yet/);
    s.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a committed repository is read from the ref, into a temp dir", () => {
  const dir = makeRepo({ git: true, commit: true });
  try {
    const s = acquire({ repo: dir, fetch: false });
    assert.equal(s.acquisition.mode, "ref");
    assert.equal(s.acquisition.ref, "HEAD");
    assert.equal(s.acquisition.dirty, false);
    assert.equal(s.acquisition.commit.length, 7);
    // Read-only on the target: the extraction is somewhere else entirely.
    assert.notEqual(s.dir, dir);
    assert.equal(readFileSync(path.join(s.dir, "src/server.ts"), "utf8"), "export const app = 1;\n");
    s.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the worktree rung reports uncommitted work as dirty", () => {
  const dir = makeRepo({ git: true, commit: true });
  try {
    assert.equal(acquire({ repo: dir, ref: "worktree" }).acquisition.dirty, false);
    writeFileSync(path.join(dir, "src", "extra.ts"), "export const b = 2;\n");
    const s = acquire({ repo: dir, ref: "worktree" });
    assert.equal(s.acquisition.mode, "worktree");
    assert.equal(s.acquisition.dirty, true);
    assert.equal(s.dir, dir, "the worktree rung scans the repo in place");
    s.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A named ref that does not exist is still an error. The ladder is for states
 * the tool can read a sensible meaning into, not for typos.
 */
test("an explicit ref that cannot be resolved is an error", () => {
  const dir = makeRepo({ git: true, commit: true });
  try {
    assert.throws(() => acquire({ repo: dir, ref: "origin/nope", fetch: false }), /cannot resolve ref/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
