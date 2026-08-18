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
