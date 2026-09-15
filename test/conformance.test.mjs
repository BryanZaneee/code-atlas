/**
 * The Phase 3 gate for the adapters: exact resolution, not counts.
 *
 * fixtures/hostile-ts/ and fixtures/hostile-py/ deliberately exercise what
 * kills a regex resolver — barrel chains, `export * from`, aliased re-exports,
 * circular imports, a per-tsconfig `@/` alias next to a sibling with none at
 * all, extensionless imports, side-effect imports, `require()`, dynamic
 * `import()`, `.tsx`; and on the Python side relative-dot imports at one, two
 * and three dots, bare `from . import x`, an `__init__.py` re-export barrel,
 * and prose inside a docstring that reads exactly like an import.
 *
 * A table of every import in the fixture and its expected outcome is the only
 * way a silent regression — a pattern that used to match and quietly stops —
 * gets caught, which a passing/failing count cannot do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { collect } from "../src/scan/walk.mjs";
import { DEFAULT_KEEP, DEFAULT_EXCLUDE } from "../src/config/defaults.mjs";
import ts from "../src/adapters/ts.mjs";
import py from "../src/adapters/py.mjs";
import go from "../src/adapters/go.mjs";
import rb from "../src/adapters/rb.mjs";
import jvm from "../src/adapters/jvm.mjs";
import rs from "../src/adapters/rs.mjs";
import { FIXTURE_DIR } from "./helpers.mjs";

/** A fixture scanned the way the pipeline scans one, with the adapter prepared. */
function fixture(name, adapter) {
  const dir = path.join(FIXTURE_DIR, name);
  const { all, paths, fileSet, src } = collect(dir, { keep: DEFAULT_KEEP, exclude: DEFAULT_EXCLUDE });
  const ctx = { config: {}, paths, fileSet, src, dir, all, warn: () => {}, progress: () => {} };
  ctx[adapter.id] = adapter.prepare(ctx);
  return ctx;
}

const ctx = fixture("hostile-ts", ts);
const { paths, src } = ctx;

/**
 * One row per import in the fixture, in source order. `spec` is read back out
 * of `extractImports` rather than duplicated here, so a table entry that
 * doesn't match what the adapter actually extracted fails loudly instead of
 * silently comparing against itself.
 */
const EXPECT = {
  "app/index.ts": [
    { spec: "./widgets", kind: "static", resolved: { kind: "internal", ids: ["app/widgets/index.ts"] } },
    { spec: "./widgets/button", kind: "static", resolved: { kind: "internal", ids: ["app/widgets/button.tsx"] } },
  ],
  "app/widgets/index.ts": [
    { spec: "./button", kind: "static", resolved: { kind: "internal", ids: ["app/widgets/button.tsx"] } },
  ],
  "app/widgets/button.tsx": [
    { spec: "@/lib/format", kind: "static", resolved: { kind: "internal", ids: ["app/lib/format.ts"] } },
  ],
  "app/lib/format.ts": [
    { spec: "./strings", kind: "static", resolved: { kind: "internal", ids: ["app/lib/strings.ts"] } },
    { spec: "@/widgets/button", kind: "static", resolved: { kind: "internal", ids: ["app/widgets/button.tsx"] } },
  ],
  "app/lib/strings.ts": [],
  "app/entry.ts": [
    { spec: "./polyfill", kind: "static", line: 1, resolved: { kind: "internal", ids: ["app/polyfill.ts"] } },
    { spec: "./shim.js", kind: "static", line: 2, resolved: { kind: "internal", ids: ["app/shim.ts"] } },
    { spec: "./legacy", kind: "require", line: 6, resolved: { kind: "internal", ids: ["app/legacy.js"] } },
    { spec: "./lazy", kind: "dynamic", line: 7, resolved: { kind: "internal", ids: ["app/lazy.ts"] } },
  ],
  // The two ways the adapter is allowed to say "I could not place this". A
  // matched alias that names no file is a config or a generated file, never a
  // third-party package, so it must not fall through to `external` either.
  "app/broken.ts": [
    { spec: "./nope", kind: "static", resolved: { kind: "unresolved", ids: ["app/nope"] } },
    { spec: "@/missing/thing", kind: "static", resolved: { kind: "unresolved", ids: ["@/missing/thing"] } },
  ],
  "app/polyfill.ts": [],
  "app/shim.ts": [],
  "app/legacy.js": [],
  "app/lazy.ts": [],
  "server/index.ts": [
    { spec: "./util/helper", kind: "static", resolved: { kind: "internal", ids: ["server/util/helper.ts"] } },
    // Same "@/" syntax as app/, but this subtree's tsconfig has no `paths` —
    // it must fall all the way through to plain external classification.
    { spec: "@/utils/shared", kind: "static", resolved: { kind: "external", ids: ["@/utils"] } },
    // server/lodash.ts exists in this same directory. No declared `baseUrl`
    // means a bare specifier never resolves against the tsconfig's own
    // directory — this must stay external, not fabricate an internal edge.
    { spec: "lodash", kind: "static", resolved: { kind: "external", ids: ["lodash"] } },
  ],
  "server/util/helper.ts": [
    { spec: "./sibling", kind: "static", resolved: { kind: "internal", ids: ["server/util/sibling.ts"] } },
  ],
  "server/util/sibling.ts": [
    { spec: "node:fs", kind: "static", resolved: { kind: "external", ids: ["node:fs"] } },
    { spec: "zod", kind: "static", resolved: { kind: "external", ids: ["zod"] } },
  ],
  "server/lodash.ts": [],
  // pkg/ DOES declare "baseUrl" (unlike server/) — a bare specifier here must
  // legitimately resolve against it, so the fix above does not just disable
  // bare-specifier resolution outright.
  "pkg/main.ts": [
    { spec: "lodash", kind: "static", resolved: { kind: "internal", ids: ["pkg/lodash.ts"] } },
  ],
  "pkg/lodash.ts": [],
};

test("every file in fixtures/hostile-ts/ is covered by the expectation table", () => {
  const covered = new Set(Object.keys(EXPECT));
  const missing = paths.filter((p) => !covered.has(p));
  assert.deepEqual(missing, [], "a fixture file with no row in EXPECT — add one or it isn't being conformance-checked");
});

/**
 * The same two assertions for either adapter. Extraction is checked as a set
 * before resolution is checked at all: that is what proves the comment, the
 * template literal and the docstring — each containing text that reads exactly
 * like an import — were blanked rather than matched. `symbols` comes back out
 * of extraction rather than being restated here, because it is what the
 * pipeline actually hands `resolve`.
 */
function conform(adapter, adapterCtx, EXPECT) {
  for (const [file, expected] of Object.entries(EXPECT)) {
    test(`${file}: extracts exactly the imports it should`, () => {
      const extracted = adapter.extractImports(adapterCtx.src.get(file), file, adapterCtx);
      assert.deepEqual(
        extracted.map((e) => e.spec).sort(),
        expected.map((e) => e.spec).sort(),
        "extracted specifiers do not match the expected set",
      );
      for (const exp of expected) {
        const got = extracted.find((e) => e.spec === exp.spec);
        assert.equal(got.kind, exp.kind, `${file} ${exp.spec}: wrong kind`);
        if (exp.line !== undefined) assert.equal(got.line, exp.line, `${file} ${exp.spec}: wrong line`);
      }
    });

    test(`${file}: resolves every import exactly as expected`, () => {
      const extracted = adapter.extractImports(adapterCtx.src.get(file), file, adapterCtx);
      for (const exp of expected) {
        const got = extracted.find((e) => e.spec === exp.spec);
        const r = adapter.resolve(file, exp.spec, adapterCtx, got?.symbols);
        assert.deepEqual(r, exp.resolved, `${file} -> "${exp.spec}"`);
      }
    });
  }
}

conform(ts, ctx, EXPECT);

// ---------------------------------------------------------------- Python

const pyCtx = fixture("hostile-py", py);

/**
 * `sys.path` here is inferred, not configured: `src/` is a root because the
 * packages under it stop having `__init__.py` at that level, and the repo root
 * is one because a pyproject.toml sits there. Nothing in this fixture carries
 * an atlas config, which is the path a stranger's repository takes.
 */
const EXPECT_PY = {
  "src/pkg/__init__.py": [
    { spec: ".engine", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/engine.py"] } },
    { spec: ".lib.util", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/lib/util.py"] } },
  ],
  "src/pkg/engine.py": [
    { spec: ".lib.util", kind: "static", line: 7, resolved: { kind: "internal", ids: ["src/pkg/lib/util.py"] } },
    // Bare `from . import x`: the symbol is the module, so this must land on
    // registry.py and not collapse onto the package's own __init__.py.
    { spec: ".", kind: "static", line: 8, resolved: { kind: "internal", ids: ["src/pkg/registry.py"] } },
    { spec: ".missing_module", kind: "static", line: 9, resolved: { kind: "unresolved", ids: [".missing_module"] } },
  ],
  // Circular with engine.py, and neither may drop out of the graph for it.
  "src/pkg/registry.py": [
    { spec: ".engine", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/engine.py"] } },
  ],
  "src/pkg/constants.py": [],
  "src/pkg/lib/__init__.py": [],
  "src/pkg/lib/util.py": [
    { spec: "re", kind: "static", resolved: { kind: "external", ids: ["re"] } },
    { spec: "..constants", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/constants.py"] } },
  ],
  "src/pkg/sub/__init__.py": [],
  "src/pkg/sub/deep.py": [
    // Three dots, then back down into the package — and through the barrel,
    // so it names the module that defines Engine rather than the barrel.
    { spec: "...pkg", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/engine.py"] } },
    { spec: "..constants", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/constants.py"] } },
    { spec: ".sibling", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/sub/sibling.py"] } },
  ],
  "src/pkg/sub/sibling.py": [],
  "tools/report.py": [
    { spec: "json", kind: "static", resolved: { kind: "external", ids: ["json"] } },
    { spec: "pkg.engine", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/engine.py"] } },
    { spec: "pkg", kind: "static", resolved: { kind: "internal", ids: ["src/pkg/lib/util.py"] } },
  ],
};

test("every file in fixtures/hostile-py/ is covered by the expectation table", () => {
  const covered = new Set(Object.keys(EXPECT_PY));
  const missing = pyCtx.paths.filter((p) => !covered.has(p));
  assert.deepEqual(missing, [], "a fixture file with no row in EXPECT_PY — add one or it isn't being conformance-checked");
});

test("sys.path roots are inferred from the layout, not from config", () => {
  // Deliberately not "every directory": if any were a root, a local module
  // named after a package would capture an import that could never mean it.
  assert.deepEqual(pyCtx.py.roots, ["src", ""]);
});

conform(py, pyCtx, EXPECT_PY);

// ---------------------------------------------------------------- Go

const goCtx = fixture("hostile-go", go);

/**
 * Go's difference from the other two: a specifier names a **package**, which is
 * a directory, so one import resolves to every `.go` file in it. That is the
 * case the array return shape exists for, and `github.com/example/widget` below
 * is the row that proves it — two files, from one specifier.
 *
 * The fixture also carries what a regex gets wrong if nobody checks: a backtick
 * raw string holding a whole fake import block, a `/* ... *\/` comment holding
 * another, the one-line `import "strings"` form the block regex cannot see, and
 * a `_` side-effect import next to an aliased one.
 */
const EXPECT_GO = {
  "widget.go": [],
  "single.go": [
    { spec: "strings", kind: "static", resolved: { kind: "external", ids: ["strings"] } },
  ],
  // The raw string in here reads exactly like an import block. Extracting nothing is the assertion.
  "internal/store/store.go": [],
  "internal/store/store_test.go": [
    { spec: "testing", kind: "static", resolved: { kind: "external", ids: ["testing"] } },
  ],
  "cmd/main.go": [
    { spec: "fmt", kind: "static", line: 14, resolved: { kind: "external", ids: ["fmt"] } },
    { spec: "encoding/json", kind: "static", resolved: { kind: "external", ids: ["encoding/json"] } },
    { spec: "net/http/pprof", kind: "static", resolved: { kind: "external", ids: ["net/http/pprof"] } },
    // One specifier, two files: the package is the directory.
    { spec: "github.com/example/widget", kind: "static",
      resolved: { kind: "internal", ids: ["single.go", "widget.go"] } },
    // A nested package, and store_test.go is deliberately not among the ids.
    { spec: "github.com/example/widget/internal/store", kind: "static",
      resolved: { kind: "internal", ids: ["internal/store/store.go"] } },
  ],
};

test("every file in fixtures/hostile-go/ is covered by the expectation table", () => {
  const covered = new Set(Object.keys(EXPECT_GO));
  const missing = goCtx.paths.filter((p) => !covered.has(p));
  assert.deepEqual(missing, [], "a fixture file with no row in EXPECT_GO — add one or it isn't being conformance-checked");
});

test("the module path comes from go.mod, which the walk never admits into src", () => {
  assert.deepEqual(goCtx.go.modules, [{ name: "github.com/example/widget", dir: "" }]);
});

test("a side-effect import binds no name, and an alias binds the alias", () => {
  const bound = new Map(go.importBindings(goCtx.src.get("cmd/main.go")).map((b) => [b.spec, [...b.localNames]]));
  assert.deepEqual(bound.get("encoding/json"), ["alias"]);
  assert.deepEqual(bound.get("net/http/pprof"), ["pprof"]);
  assert.deepEqual(bound.get("github.com/example/widget"), ["widget"]);
});

conform(go, goCtx, EXPECT_GO);

// ---------------------------------------------------------------- Ruby

const rbCtx = fixture("hostile-rb", rb);

/**
 * Ruby's two modes, which are Python's two modes wearing different syntax:
 * `require_relative` resolves against the requiring file, plain `require`
 * against a load path. The relativity is normalised onto the specifier at
 * extraction — `require_relative "helper"` comes out as `./helper` — because
 * the two forms are otherwise the same string and `resolve` sees only strings.
 *
 * The load path is inferred, never read: Ruby assembles the real `$LOAD_PATH`
 * at runtime out of a gemspec, a Gemfile and `-I` flags. `lib/` and each
 * immediate subdirectory of `app/` are the conventional entries, and
 * `require "store/row"` below resolving under `lib/` with no prefix is that
 * inference doing its job.
 *
 * The fixture carries the two things that fool a regex: an `=begin`/`=end`
 * block holding a require, and a require inside a single-quoted string. The
 * second is the one worth having — it produced a phantom gem until `require`
 * was anchored to a statement position, and a phantom edge is worse than a
 * missed one.
 */
const EXPECT_RB = {
  "lib/widget.rb": [
    { spec: "./store/row", kind: "relative", resolved: { kind: "internal", ids: ["lib/store/row.rb"] } },
    { spec: "json", kind: "static", resolved: { kind: "external", ids: ["json"] } },
  ],
  // Every require in here is inside a comment. Extracting nothing is the assertion.
  "lib/store/row.rb": [],
  "app/models/document.rb": [
    { spec: "../../lib/widget", kind: "relative", resolved: { kind: "internal", ids: ["lib/widget.rb"] } },
    { spec: "store/row", kind: "static", resolved: { kind: "internal", ids: ["lib/store/row.rb"] } },
    { spec: "rails/all", kind: "static", resolved: { kind: "external", ids: ["rails"] } },
  ],
  "spec/widget_spec.rb": [
    { spec: "../lib/widget", kind: "relative", resolved: { kind: "internal", ids: ["lib/widget.rb"] } },
    { spec: "rspec", kind: "static", resolved: { kind: "external", ids: ["rspec"] } },
  ],
};

test("every file in fixtures/hostile-rb/ is covered by the expectation table", () => {
  const covered = new Set(Object.keys(EXPECT_RB));
  const missing = rbCtx.paths.filter((p) => !covered.has(p));
  assert.deepEqual(missing, [], "a fixture file with no row in EXPECT_RB — add one or it isn't being conformance-checked");
});

test("the load path is inferred from the layout, and the root is not on it", () => {
  // "" is deliberately absent: no .rb sits at the top level here, and an empty
  // root would otherwise claim every gem name in the repository.
  assert.deepEqual(rbCtx.rb.roots, ["app/models", "lib"]);
});

test("a require inside a string is not an import", () => {
  const specs = rb.extractImports(rbCtx.src.get("app/models/document.rb")).map((e) => e.spec);
  assert.ok(!specs.includes("in_a_string"), "a require inside a single-quoted string was extracted as a real one");
});

conform(rb, rbCtx, EXPECT_RB);

// ---------------------------------------------------------------- Java / Kotlin

const jvmCtx = fixture("hostile-java", jvm);

/**
 * Java and Kotlin share one adapter because they share the one thing that
 * matters: `import a.b.C` names a TYPE, and the file holding it is the package
 * directory plus the class name, under whatever source root the build tool put
 * on the path. Nothing declares that root — no tsconfig, no go.mod — so it is
 * inferred the way `py.mjs` infers `sys.path`.
 *
 * Two rows carry the interesting cases. `com.example.store.*` is a wildcard, so
 * it names the package and resolves to both files in that directory — Go's
 * one-specifier-many-files shape a second time, and the reason `ids` is an
 * array. `com.example.store.Row.EMPTY` is a static member import, so the type
 * is one segment up from where the specifier stops.
 *
 * Note that the Kotlin file resolves into `.java` files: a source root is a
 * source root, and the two languages compile against each other. An adapter
 * that indexed only its own extension would have missed every one of those.
 *
 * The fixture carries a Java text block and a Kotlin raw string, each holding
 * a line that reads exactly like an import, plus both comment forms.
 */
const EXPECT_JVM = {
  "src/main/java/com/example/Widget.java": [
    { spec: "java.util.List", kind: "static", resolved: { kind: "external", ids: ["java.util"] } },
    { spec: "com.example.store.Row", kind: "static",
      resolved: { kind: "internal", ids: ["src/main/java/com/example/store/Row.java"] } },
    // A static member: the type is one segment up.
    { spec: "com.example.store.Row.EMPTY", kind: "static",
      resolved: { kind: "internal", ids: ["src/main/java/com/example/store/Row.java"] } },
  ],
  "src/main/java/com/example/store/Row.java": [],
  "src/main/java/com/example/store/Table.java": [],
  "src/main/kotlin/com/example/Report.kt": [
    // One specifier, every file in the package.
    { spec: "com.example.store.*", kind: "static",
      resolved: { kind: "internal", ids: ["src/main/java/com/example/store/Row.java", "src/main/java/com/example/store/Table.java"] } },
    { spec: "com.example.Widget", kind: "static",
      resolved: { kind: "internal", ids: ["src/main/java/com/example/Widget.java"] } },
    { spec: "kotlin.collections.List", kind: "static", resolved: { kind: "external", ids: ["kotlin.collections"] } },
  ],
  "src/test/java/com/example/WidgetTest.java": [
    { spec: "org.junit.jupiter.api.Test", kind: "static", resolved: { kind: "external", ids: ["org.junit"] } },
    { spec: "com.example.Widget", kind: "static",
      resolved: { kind: "internal", ids: ["src/main/java/com/example/Widget.java"] } },
  ],
};

test("every file in fixtures/hostile-java/ is covered by the expectation table", () => {
  const covered = new Set(Object.keys(EXPECT_JVM));
  const missing = jvmCtx.paths.filter((p) => !covered.has(p));
  assert.deepEqual(missing, [], "a fixture file with no row in EXPECT_JVM — add one or it isn't being conformance-checked");
});

test("source roots come from the layout, and the test tree is one of them", () => {
  assert.deepEqual(jvmCtx.jvm.roots, ["src/main/kotlin", "src/main/java", "src/test/java"]);
});

test("Kotlin's `as` binds the alias, and a wildcard binds nothing nameable", () => {
  const bound = jvm.importBindings(jvmCtx.src.get("src/main/kotlin/com/example/Report.kt"));
  const by = new Map(bound.map((b) => [b.spec, [...b.localNames]]));
  assert.deepEqual(by.get("com.example.Widget"), ["W"]);
  assert.ok(!by.has("com.example.store.*"), "a wildcard import bound a local name");
});

conform(jvm, jvmCtx, EXPECT_JVM);

// ---------------------------------------------------------------- Rust

const rsCtx = fixture("hostile-rust", rs);

/**
 * Rust, and the table is as much a record of what is NOT read as of what is.
 *
 * What resolves cleanly is the module tree: `mod foo;` names a file beside the
 * declarer, or under a directory named after it when the declarer is not itself
 * a `mod.rs`. `src/util.rs` declaring `mod helpers;` and landing on
 * `src/util/helpers.rs` is that second rule, and it is the one a naive reading
 * gets wrong.
 *
 * What is deliberately NOT followed is `pub use` re-export chains. See
 * `use crate::store::Row` below: it lands on `src/store/mod.rs`, which is where
 * the name is exported from, not on `src/store/row.rs`, which is where the type
 * is defined. Following it needs a symbol table and a fixpoint over re-export
 * chains — parsing, not matching — so the map under-reports by one hop and says
 * so here. Same for `#[path = "..."]` and any `mod` behind a `cfg`.
 *
 * Two shapes worth naming. `mod inner { ... }` in row.rs declares no file and
 * must not resolve to one, which is why the pattern insists on the semicolon.
 * And `use widget::Widget` in the integration test names the library by its
 * Cargo package name rather than by `crate`, so without reading Cargo.toml
 * every integration test in every Rust repo would hang off the graph entirely.
 */
const EXPECT_RS = {
  "src/lib.rs": [
    { spec: "store", kind: "mod", resolved: { kind: "internal", ids: ["src/store/mod.rs"] } },
    { spec: "util", kind: "mod", resolved: { kind: "internal", ids: ["src/util.rs"] } },
    { spec: "std::collections::HashMap", kind: "use", resolved: { kind: "external", ids: ["std"] } },
    // Lands on the re-exporting mod.rs, not on row.rs. The documented under-report.
    { spec: "crate::store::Row", kind: "use", resolved: { kind: "internal", ids: ["src/store/mod.rs"] } },
  ],
  "src/store/mod.rs": [
    { spec: "row", kind: "mod", resolved: { kind: "internal", ids: ["src/store/row.rs"] } },
    { spec: "self::row::Row", kind: "use", resolved: { kind: "internal", ids: ["src/store/row.rs"] } },
    { spec: "super::util::trim", kind: "use", resolved: { kind: "internal", ids: ["src/util.rs"] } },
  ],
  // `mod inner { ... }` declares no file. Extracting nothing is the assertion.
  "src/store/row.rs": [],
  "src/util.rs": [
    { spec: "self::helpers::squeeze", kind: "use", resolved: { kind: "internal", ids: ["src/util/helpers.rs"] } },
    // util.rs is not a mod.rs, so its children live under util/.
    { spec: "helpers", kind: "mod", resolved: { kind: "internal", ids: ["src/util/helpers.rs"] } },
  ],
  "src/util/helpers.rs": [],
  "tests/integration.rs": [
    // Named by the Cargo package, not by `crate`: a separate crate links against the library.
    { spec: "widget::Widget", kind: "use", resolved: { kind: "internal", ids: ["src/lib.rs"] } },
    { spec: "serde::Serialize", kind: "use", resolved: { kind: "external", ids: ["serde"] } },
  ],
};

test("every file in fixtures/hostile-rust/ is covered by the expectation table", () => {
  const covered = new Set(Object.keys(EXPECT_RS));
  const missing = rsCtx.paths.filter((p) => !covered.has(p));
  assert.deepEqual(missing, [], "a fixture file with no row in EXPECT_RS — add one or it isn't being conformance-checked");
});

test("the crate name comes from Cargo.toml, which the walk never admits into src", () => {
  assert.deepEqual(rsCtx.rs.crates, [{ name: "widget", dir: "" }]);
  assert.deepEqual(rsCtx.rs.roots, ["src"]);
});

test("an inline `mod x { }` declares no file and is never extracted", () => {
  const specs = rs.extractImports(rsCtx.src.get("src/store/row.rs")).map((e) => e.spec);
  assert.deepEqual(specs, [], "an inline module was extracted as a file-declaring one");
});

conform(rs, rsCtx, EXPECT_RS);
