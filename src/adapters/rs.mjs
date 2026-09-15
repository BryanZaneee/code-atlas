/**
 * Rust, and the honest limits of reading it with a regex.
 *
 * Rust is the language ROADMAP.md names as the hard one, and the reason is
 * real: `mod` and `use` describe a module tree that only partly matches the file
 * tree. What follows is the part that maps cleanly, and the part that does not
 * is skipped and counted rather than guessed at.
 *
 * **What resolves.**
 *   `mod foo;`            declares a module, and the file is beside the
 *                         declaring file — or under the directory named after
 *                         it, when the declarer is not itself a `mod.rs`. This
 *                         is the structural backbone of a crate and it is
 *                         entirely reliable.
 *   `use crate::a::b::C`  a path from the crate root, which is `src/lib.rs` or
 *                         `src/main.rs`. The last segment is usually an item
 *                         rather than a module, so the full path is tried and
 *                         then one segment is dropped.
 *   `use self::` `super::` the same, anchored at the file's own module or its
 *                         parent.
 *   anything else         a crate: `std`, `serde`, a workspace member. External.
 *
 * **What does not, and is left unresolved on purpose.**
 *   `pub use` re-exports. A crate that funnels its API through `lib.rs` has
 *   every `use crate::Thing` land on `lib.rs` rather than on the file defining
 *   `Thing`. Following it needs the symbol table `symbols` exists for and a
 *   fixpoint over re-export chains, which is parsing, not matching.
 *   `#[path = "..."]` on a `mod`, which relocates a module arbitrarily.
 *   `mod` inside a `cfg!` or a macro.
 *
 * That is the standing trade — under-report, count it, report it in
 * `atlas scan` — rather than a new exception to it.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { withLines, blankCLike } from "./lex.mjs";

/** `mod foo;` with the semicolon: an inline `mod foo { ... }` declares no file and must not match. */
const MOD = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm;
/** `use a::b::C;`, `use a::b::{C, D};`, `use a::b as c;` — the head path is what names a file. */
const USE = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([\w:]+)/gm;

/** Rust raw strings are `r"..."` and `r#"..."#`; a `//` inside one is not a comment. Nested hashes beyond one are not tracked, which blanks too little rather than too much. */
const blank = (text) => blankCLike(text, { raw: [['r#"', '"#'], ['r"', '"']] });

const isRoot = (p) => /(^|\/)(lib|main|mod)\.rs$/.test(p);

/** The directory a file's child modules live in: beside a `mod.rs`/`lib.rs`/`main.rs`, and under a directory named after any other file. */
function childDir(from) {
  const dir = path.posix.dirname(from) === "." ? "" : path.posix.dirname(from);
  if (isRoot(from)) return dir;
  return [dir, path.posix.basename(from, ".rs")].filter(Boolean).join("/");
}

/** A module path under `base` as a file: `a/b.rs`, or `a/b/mod.rs`. */
function fileForModule(base, segments, ctx) {
  const stem = [base, ...segments].filter(Boolean).join("/");
  if (ctx.fileSet.has(`${stem}.rs`)) return `${stem}.rs`;
  if (ctx.fileSet.has(`${stem}/mod.rs`)) return `${stem}/mod.rs`;
  return null;
}

/** Each `name` a Cargo.toml declares, with the directory it governs. An integration test under `tests/` names the library by this name rather than by `crate`, so without it every such test hangs off the graph. Read off disk, since `keep` never admits a .toml into `src`. */
function crates(ctx) {
  const out = [];
  for (const p of ctx.all ?? []) {
    if (path.posix.basename(p) !== "Cargo.toml") continue;
    let name;
    try {
      name = readFileSync(path.join(ctx.dir, p), "utf8").match(/^[ \t]*name[ \t]*=[ \t]*"([^"]+)"/m)?.[1];
    } catch {
      continue; // unreadable: files under it still resolve, just with the crate name external
    }
    // Cargo normalises a dash in a package name to an underscore in the import path.
    if (name) out.push({ name: name.replace(/-/g, "_"), dir: path.posix.dirname(p) === "." ? "" : path.posix.dirname(p) });
  }
  return out.sort((a, b) => b.dir.length - a.dir.length);
}

/** The file that IS a crate root directory: `use crate::Thing` and `use widget::Thing` both name an item re-exported from it. */
const rootFile = (base, ctx) => ["lib.rs", "main.rs"].map((f) => [base, f].filter(Boolean).join("/")).find((p) => ctx.fileSet.has(p)) ?? null;

/** Every crate root in the tree — `src/lib.rs` and `src/main.rs`, plus each `src/bin/*.rs`. A workspace has several, so this is a list. */
function crateRoots(ctx) {
  return ctx.paths
    .filter((p) => /(^|\/)src\/(lib|main)\.rs$/.test(p) || /(^|\/)src\/bin\/[^/]+\.rs$/.test(p))
    .map((p) => (path.posix.dirname(p) === "." ? "" : path.posix.dirname(p)))
    .filter((d, i, a) => a.indexOf(d) === i)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** The crate root directory governing a file: the longest one it sits under. */
const rootFor = (from, roots) => roots.find((r) => (r === "" ? true : from.startsWith(r + "/"))) ?? "";

function specs(text) {
  const clean = blank(text);
  const matches = [];
  for (const m of clean.matchAll(MOD)) matches.push({ index: m.index, spec: m[1], kind: "mod" });
  for (const m of clean.matchAll(USE)) matches.push({ index: m.index, spec: m[1], kind: "use" });
  return matches;
}

export default {
  id: "rs",
  extensions: [".rs"],
  blankComments: blank,

  /** A `use` binds its last segment, a `mod` binds its own name. Neither is renamed here: `as` renaming is dropped by the head-path match, and reading it back would need the brace group parsed. */
  importBindings(text) {
    return specs(text).map(({ spec }) => ({ spec, localNames: new Set([spec.split("::").pop()]) }));
  },

  /** Rust keeps unit tests in the file they test, so only the integration convention is a guess worth making: tests/x.rs covers src/x.rs. */
  testSubject: (p) => p.replace(/(^|\/)tests\//, "$1src/"),

  prepare(ctx) {
    return { roots: crateRoots(ctx), crates: crates(ctx) };
  },

  extractImports(text) {
    return withLines(text, specs(text));
  },

  resolve(from, spec, ctx) {
    const roots = ctx.rs?.roots ?? [];

    // `mod foo;` — the one form that names a file with no ambiguity at all.
    if (!spec.includes("::")) {
      const hit = fileForModule(childDir(from), [spec], ctx);
      if (hit) return { kind: "internal", ids: [hit] };
      // Also a bare `use serde;`, which is a crate rather than a module.
      return ctx.fileSet.has(from) && /^[a-z_]\w*$/.test(spec)
        ? { kind: "unresolved", ids: [spec] }
        : { kind: "external", ids: [spec] };
    }

    const segs = spec.split("::").filter(Boolean);
    const head = segs[0];
    let base = null;
    let rest = segs.slice(1);

    if (head === "crate") base = rootFor(from, roots);
    else if (head === "self") base = childDir(from);
    else if (head === "super") {
      const d = childDir(from);
      base = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "";
    } else {
      // A crate named by a Cargo.toml in this tree is this tree — which is how an
      // integration test under `tests/` reaches the library it is testing.
      const own = (ctx.rs?.crates ?? []).find((c) => c.name === head && (c.dir === "" || from.startsWith(c.dir + "/")));
      if (!own) return { kind: "external", ids: [head] };
      base = rootFor([own.dir, "src/lib.rs"].filter(Boolean).join("/"), roots);
    }

    // The last segment is usually an item — a type, a function — rather than a module, so the full path is tried first and then one segment is dropped.
    const hit =
      fileForModule(base, rest, ctx) ??
      (rest.length > 1 ? fileForModule(base, rest.slice(0, -1), ctx) : null) ??
      // One segment left under a crate root is an item re-exported from the root itself, which is where a `pub use` chain would have started.
      (rest.length <= 1 && head !== "self" && head !== "super" ? rootFile(base, ctx) : null);
    if (hit) return { kind: "internal", ids: [hit] };
    return { kind: "unresolved", ids: [spec] };
  },
};
