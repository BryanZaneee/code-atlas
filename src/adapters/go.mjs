/**
 * Go.
 *
 * The interesting difference from TypeScript and Python: a Go import names a
 * **package**, and a package is a directory. One specifier therefore resolves
 * to every `.go` file in that directory, which is the case `resolve()`'s array
 * return shape was designed for.
 *
 * Internal versus external is decided by `go.mod`. A specifier under the
 * declared module path is this repository; anything else is stdlib or a
 * dependency, and neither is a file we have.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { withLines, blankCLike } from "./lex.mjs";

/** `import ( ... )` — a factored block, which is how gofmt writes more than one. */
const IMPORT_BLOCK = /^[ \t]*import[ \t]*\(([\s\S]*?)^[ \t]*\)/gm;
/** `import "fmt"` and `import alias "fmt"` on one line. */
const IMPORT_ONE = /^[ \t]*import[ \t]+(?:([\w.]+)[ \t]+)?"([^"\n]+)"/gm;
/** One line inside a block: an optional name (`alias`, `_`, `.`) then the quoted path. */
const BLOCK_LINE = /^[ \t]*(?:([\w.]+)[ \t]+)?"([^"\n]+)"/gm;

/** Backticks are Go's raw strings, and a `//` inside one is not a comment. */
const blank = (text) => blankCLike(text, { raw: [["`", "`"]] });

/** Every `module` line in the tree, longest path first so a nested module wins over the one containing it. Read from `ctx.dir`, since `keep` never admits `go.mod` into `src` — the same reason `ts.mjs` reads `tsconfig.json` off disk. */
function modules(ctx) {
  const out = [];
  for (const p of ctx.all ?? []) {
    if (path.posix.basename(p) !== "go.mod") continue;
    let name;
    try {
      name = readFileSync(path.join(ctx.dir, p), "utf8").match(/^module[ \t]+(\S+)/m)?.[1];
    } catch {
      continue; // unreadable: files under it still resolve, just with everything external
    }
    if (!name) continue;
    const dir = path.posix.dirname(p);
    out.push({ name, dir: dir === "." ? "" : dir });
  }
  return out.sort((a, b) => b.name.length - a.name.length);
}

/** Every specifier in the file, block form and one-line form alike, with its line. */
function specs(text) {
  const clean = blank(text);
  const matches = [];
  for (const block of clean.matchAll(IMPORT_BLOCK)) {
    const at = block.index + block[0].indexOf("(") + 1;
    for (const m of block[1].matchAll(BLOCK_LINE)) {
      matches.push({ index: at + m.index, name: m[1], spec: m[2], kind: "static" });
    }
  }
  for (const m of clean.matchAll(IMPORT_ONE)) {
    matches.push({ index: m.index, name: m[1], spec: m[2], kind: "static" });
  }
  return matches;
}

export default {
  id: "go",
  extensions: [".go"],
  blankComments: blank,

  /** `_` imports for a side effect and `.` dot-imports bind no usable name; the rest bind the package's last segment or the alias written. */
  importBindings(text) {
    return specs(text).map(({ spec, name }) => ({
      spec,
      localNames: new Set(name && name !== "_" && name !== "." ? [name] : [spec.split("/").pop()]),
    }));
  },

  /** Go's own convention, and the only one: x_test.go covers x.go, beside it. */
  testSubject: (p) => p.replace(/_test\.go$/, ".go"),

  prepare(ctx) {
    return { modules: modules(ctx) };
  },

  extractImports(text) {
    return withLines(text, specs(text).map(({ index, spec, kind }) => ({ index, spec, kind })));
  },

  resolve(from, spec, ctx) {
    const mod = (ctx.go?.modules ?? []).find((m) => spec === m.name || spec.startsWith(m.name + "/"));
    if (!mod) {
      // Stdlib and dependencies alike: the first segment is the package we can name, and neither is a file in this tree.
      return { kind: "external", ids: [spec] };
    }
    const rel = spec === mod.name ? "" : spec.slice(mod.name.length + 1);
    const dir = path.posix.join(mod.dir || ".", rel);
    const want = dir === "." ? "" : dir;
    // A package is a directory, so every .go file directly in it is the target. Tests are excluded: they are part of the package but are never what an importer meant.
    const ids = (ctx.paths ?? []).filter(
      (p) => p.endsWith(".go") && !p.endsWith("_test.go") && (path.posix.dirname(p) === "." ? "" : path.posix.dirname(p)) === want,
    );
    return ids.length ? { kind: "internal", ids: ids.sort() } : { kind: "unresolved", ids: [spec] };
  },
};
