/** Source acquisition, read-only on the target: the ref -> worktree -> fs ladder drops a rung only when the one above cannot run, and the sole write is the optional `git fetch`. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Scan a directory as it sits. No git, so nothing about it is reproducible. */
function fsRung(repo) {
  return {
    dir: repo,
    commit: "",
    // `dirty` is unknowable rather than false: without git there is nothing to be dirty relative to.
    acquisition: { mode: "fs", ref: null, commit: null, dirty: null },
    cleanup: () => {},
  };
}

/** Scan the working tree, uncommitted work included; the commit is recorded where there is one, so the map can say what it is a modification of. */
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
  // Returns null instead of throwing: a negative answer here is a rung of the ladder, not a failure.
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
    // An unborn HEAD: the working tree is the only reading of "scan this repo" that can succeed.
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
