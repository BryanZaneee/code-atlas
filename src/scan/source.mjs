/**
 * Source acquisition. Read-only on the target, always.
 *
 * `git archive <ref> | tar -x` into a temp directory: no branch is switched and
 * no file in the target is modified. The only write is the optional `git fetch`,
 * which touches remote refs and nothing else.
 *
 * Phase 2 adds the rest of the ladder — worktree scan and a plain fs walk for a
 * directory that is not a git repo or has no commits yet. Today there is one
 * rung, and `meta.acquisition` reports which one ran so the UI can say whether
 * the picture includes uncommitted work.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function acquire({ repo, ref, fetch = true, warn = () => {} }) {
  // The fs rung: scan a directory as it sits, no git involved. Landed early
  // because the in-repo fixtures are not git repositories and the test suite
  // must not depend on one. Phase 2 adds the rungs above it (worktree, and a
  // git repo whose HEAD is unborn) and the fallback logic that picks between
  // them; today you ask for this one explicitly with --ref fs.
  if (ref === "fs") {
    return {
      dir: repo,
      commit: "",
      // A plain-fs scan includes uncommitted work, so it is not reproducible
      // from any commit. The UI says so; dirty is unknowable here, not false.
      acquisition: { mode: "fs", ref: null, commit: null, dirty: null },
      cleanup: () => {},
    };
  }

  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 }).trim();

  let commit;
  try {
    commit = git("rev-parse", ref);
  } catch {
    throw new Error(`cannot resolve ref "${ref}" in ${repo}`);
  }

  if (fetch && ref.startsWith("origin/")) {
    try {
      git("fetch", "origin", "--quiet");
      commit = git("rev-parse", ref);
    } catch {
      warn("warn: git fetch failed, using the cached ref");
    }
  }

  const dir = mkdtempSync(path.join(tmpdir(), "atlas-"));
  try {
    execFileSync(
      "sh",
      ["-c", `git archive --format=tar ${JSON.stringify(ref)} | tar -x -C ${JSON.stringify(dir)}`],
      { cwd: repo },
    );
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`git archive failed — ${e.message}`);
  }

  return {
    dir,
    commit,
    // A ref scan is reproducible from a commit; a worktree scan would not be.
    acquisition: { mode: "ref", ref, commit: commit.slice(0, 7), dirty: false },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
