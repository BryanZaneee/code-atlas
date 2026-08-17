/**
 * Source acquisition. Read-only on the target, always.
 *
 * The ladder, in the order it is tried:
 *
 *   ref       `git archive <ref> | tar -x` into a temp dir. Reproducible from a
 *             commit, so a screenshot of it means something later.
 *   worktree  the working tree as it sits. Includes uncommitted work, which is
 *             why `dirty` is reported and the UI badges it.
 *   fs        a plain directory walk, no git involved at all.
 *
 * A rung is chosen automatically only when the one above it cannot run: not a
 * git repository, or a repository with no commits yet, where `rev-parse
 * --git-dir` succeeds while `rev-parse HEAD` fails. Neither is an error — they
 * are ordinary states for a repo somebody started this morning, and exiting on
 * them would make the tool useless exactly when a map is most wanted.
 *
 * `--ref fs` and `--ref worktree` name a rung explicitly.
 *
 * The only write any of this performs is the optional `git fetch`, which touches
 * remote refs and nothing else. No branch is switched, no file is modified.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Scan a directory as it sits. No git, so nothing about it is reproducible. */
function fsRung(repo) {
  return {
    dir: repo,
    commit: "",
    // Not reproducible from any commit, and `dirty` is unknowable rather than
    // false: without git there is nothing to be dirty relative to.
    acquisition: { mode: "fs", ref: null, commit: null, dirty: null },
    cleanup: () => {},
  };
}

/**
 * Scan the working tree of a git repository, uncommitted work included. The
 * commit is recorded where there is one, so the picture can at least say what it
 * is a modification of.
 */
function worktreeRung(repo, git) {
  const commit = git("rev-parse", "HEAD") ?? "";
  const status = git("status", "--porcelain");
  return {
    dir: repo,
    commit,
    acquisition: {
      mode: "worktree",
      ref: null,
      commit: commit ? commit.slice(0, 7) : null,
      // No commits yet means everything in the tree is uncommitted.
      dirty: commit ? Boolean(status) : true,
    },
    cleanup: () => {},
  };
}

export function acquire({ repo, ref = "HEAD", fetch = true, warn = () => {} }) {
  // Returns null instead of throwing: every caller here is asking a question
  // whose negative answer is a rung of the ladder, not a failure.
  const git = (...args) => {
    try {
      return execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 1 << 28,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };

  if (ref === "fs") return fsRung(repo);
  if (ref === "worktree") {
    if (git("rev-parse", "--git-dir") === null) {
      warn("warn: not a git repository — scanning the directory as it sits");
      return fsRung(repo);
    }
    return worktreeRung(repo, git);
  }

  if (git("rev-parse", "--git-dir") === null) {
    warn(`warn: ${repo} is not a git repository — scanning the directory as it sits`);
    return fsRung(repo);
  }

  let commit = git("rev-parse", ref);
  if (commit === null) {
    // An unborn HEAD: the repository exists, the commit does not. Falling to the
    // working tree is the only reading of "scan this repo" that can succeed.
    if (ref === "HEAD") {
      warn("warn: no commits yet — scanning the working tree instead");
      return worktreeRung(repo, git);
    }
    throw new Error(`cannot resolve ref "${ref}" in ${repo}`);
  }

  if (fetch && ref.startsWith("origin/")) {
    if (git("fetch", "origin", "--quiet") === null) warn("warn: git fetch failed, using the cached ref");
    else commit = git("rev-parse", ref) ?? commit;
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
