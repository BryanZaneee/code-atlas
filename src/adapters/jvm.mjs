/**
 * Java and Kotlin, in one adapter, because they share everything that matters
 * here: the same `import a.b.C;` syntax, the same package-to-directory
 * convention, and the same wildcard form.
 *
 * Two differences from every adapter before it:
 *
 * **An import names a type, not a file.** `import com.example.Widget` is the
 * class, and the file is the package directory plus the class name. A wildcard
 * `import com.example.*` names the whole package, which resolves to every
 * source file in that directory — Go's one-specifier-many-files shape again.
 *
 * **The package-to-directory mapping is conventional, not declared.** There is
 * no tsconfig and no go.mod to read: `com.example.Widget` lives at
 * `<root>/com/example/Widget.java` for whatever `<root>` the build tool put on
 * the source path. Those roots are inferred the way `py.mjs` infers `sys.path`.
 *
 * Kotlin bends the convention — a file may sit anywhere and declare any
 * package, and a file may hold several public classes. So the directory
 * convention is tried first and a `package` declaration scan is the fallback,
 * which covers the Kotlin projects that ignore the layout.
 */
import path from "node:path";
import { withLines, blankCLike } from "./lex.mjs";

const EXTENSIONS = [".java", ".kt", ".kts"];
/** `import a.b.C;`, `import static a.b.C.m;`, `import a.b.*` — the trailing semicolon is optional because Kotlin has none. */
const IMPORT = /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+(?:\.\*)?)[ \t]*;?[ \t]*$/gm;
/** Kotlin renames on import: `import a.b.C as D`. */
const IMPORT_AS = /^[ \t]*import[ \t]+([\w.]+)[ \t]+as[ \t]+(\w+)[ \t]*$/gm;
const PACKAGE = /^[ \t]*package[ \t]+([\w.]+)[ \t]*;?[ \t]*$/m;

/** Kotlin's raw strings are triple-quoted, and a `//` inside one is not a comment. Java text blocks use the same delimiter. */
const blank = (text) => blankCLike(text, { raw: [['"""', '"""']] });

/** The conventional source roots, plus any directory a `package` declaration says is one. Longest first, so the most specific root claims a package. */
function inferRoots(ctx) {
  const roots = new Set();
  for (const p of ctx.paths) {
    if (!EXTENSIONS.some((e) => p.endsWith(e))) continue;
    // Maven and Gradle both write src/<sourceSet>/<lang>/, which is where the package tree starts.
    const conventional = p.match(/^(.*?src\/[^/]+\/(?:java|kotlin))\//);
    if (conventional) { roots.add(conventional[1]); continue; }

    // Otherwise back the declared package out of the file's own directory: if
    // `a/b/C.kt` declares `package a.b` then `` is a root, and if it declares
    // nothing then its own directory is.
    const declared = (blank(ctx.src.get(p) ?? "").match(PACKAGE) ?? [])[1];
    const dir = path.posix.dirname(p) === "." ? "" : path.posix.dirname(p);
    if (!declared) { roots.add(dir); continue; }
    const suffix = declared.split(".").join("/");
    if (dir === suffix) roots.add("");
    else if (dir.endsWith("/" + suffix)) roots.add(dir.slice(0, -(suffix.length + 1)));
  }
  return [...roots].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function specs(text) {
  const clean = blank(text);
  const matches = [];
  const seen = new Set();
  for (const m of clean.matchAll(IMPORT_AS)) {
    matches.push({ index: m.index, spec: m[1], name: m[2], kind: "static" });
    seen.add(m.index);
  }
  for (const m of clean.matchAll(IMPORT)) {
    // `import a.b.C as D` also matches the plain form; the aliased pass already has it.
    if (seen.has(m.index)) continue;
    matches.push({ index: m.index, spec: m[1], kind: "static" });
  }
  return matches;
}

const fileFor = (stem, ctx) => EXTENSIONS.map((e) => `${stem}${e}`).find((p) => ctx.fileSet.has(p)) ?? null;

export default {
  id: "jvm",
  extensions: EXTENSIONS,
  blankComments: blank,

  /** An import binds the type's simple name, or the alias Kotlin gave it. A wildcard binds nothing nameable. */
  importBindings(text) {
    return specs(text)
      .filter(({ spec }) => !spec.endsWith(".*"))
      .map(({ spec, name }) => ({ spec, localNames: new Set([name ?? spec.split(".").pop()]) }));
  },

  /** Maven and Gradle both mirror the main tree under test: src/test/java/a/b/CTest.java covers src/main/java/a/b/C.java. */
  testSubject: (p) =>
    p.replace(/src\/test\/(java|kotlin)\//, "src/main/$1/").replace(/(Test|Spec)\.(java|kts?)$/, ".$2"),

  prepare(ctx) {
    return { roots: inferRoots(ctx) };
  },

  extractImports(text) {
    return withLines(text, specs(text).map(({ index, spec, kind }) => ({ index, spec, kind })));
  },

  resolve(from, spec, ctx) {
    const roots = ctx.jvm?.roots ?? [];

    // A wildcard names the package, so every source file in that directory is the target: one specifier, many files.
    if (spec.endsWith(".*")) {
      const dir = spec.slice(0, -2).split(".").join("/");
      for (const root of roots) {
        const want = [root, dir].filter(Boolean).join("/");
        const ids = ctx.paths.filter(
          (p) => EXTENSIONS.some((e) => p.endsWith(e)) && (path.posix.dirname(p) === "." ? "" : path.posix.dirname(p)) === want,
        );
        if (ids.length) return { kind: "internal", ids: ids.sort() };
      }
      return { kind: "external", ids: [spec.slice(0, -2)] };
    }

    const asPath = spec.split(".").join("/");
    for (const root of roots) {
      const hit = fileFor([root, asPath].filter(Boolean).join("/"), ctx);
      if (hit) return { kind: "internal", ids: [hit] };
    }
    // `import a.b.C.CONSTANT` — a static member, so the type is one segment up.
    const parent = asPath.slice(0, asPath.lastIndexOf("/"));
    if (parent) {
      for (const root of roots) {
        const hit = fileFor([root, parent].filter(Boolean).join("/"), ctx);
        if (hit) return { kind: "internal", ids: [hit] };
      }
    }
    // Not under any root: the JDK, or a dependency. Two segments name it the way a scoped npm package takes two.
    return { kind: "external", ids: [spec.split(".").slice(0, 2).join(".")] };
  },
};
