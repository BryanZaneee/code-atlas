# Adapters

An adapter turns a **specifier string into file paths**. That is the whole job,
and it is the only part of the scanner that knows any language.

`src/adapters/` ↔ `src/model/` is the load-bearing boundary in this codebase:
anything that reads a specifier is language-specific and belongs in an adapter;
everything downstream of "the edge list exists" is language-agnostic and belongs
in the model. Adapters are the documented contribution surface, so **a change
here is an API change** — this file moves with it.

## The interface

```js
export default {
  id: "ts",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  prepare(ctx) { … },                       // optional
  extractImports(text, from, ctx) { … },
  resolve(from, spec, ctx, symbols) { … },
  blankComments(text) { … },
  importBindings(text) { … },
  testSubject(path) { … },
};
```

Register it in `src/adapters/index.mjs`. `adapterFor(path)` picks the **first**
adapter whose `extensions` match, so the list order is the tie-break.

| member | contract |
| --- | --- |
| `id` | unique; also the key `prepare`'s return value is stored under on `ctx` |
| `extensions` | the file suffixes this adapter claims. A path no adapter claims yields no edges — a supported outcome, not a failure |
| `prepare(ctx)` | optional, called **once** before extraction. Return whatever per-repo state resolution needs; it lands on `ctx[id]` |
| `extractImports(text, from, ctx)` | → `[{ spec, symbols?, kind, line }]`, in source order. One entry per import *site*, not per unique specifier |
| `resolve(from, spec, ctx, symbols)` | → `{ kind, ids }` where `kind` is `"internal"`, `"external"` or `"unresolved"` |
| `blankComments(text)` | → text of the **same length**, comments replaced by spaces, ordinary quoted strings left intact |
| `importBindings(text)` | → `[{ spec, localNames: Set, symbols? }]`: which local names each import binds |
| `testSubject(path)` | → the source path a test at `path` conventionally covers, by naming convention alone |

### The three lexing members

These exist because the model used to do this work itself, branching on language
or reaching into the TypeScript adapter directly. Both were wrong in the same
way, and one of them was a live bug: Python files were blanked with the
TypeScript blanker, which does not know `#`, so a commented-out route was
extracted as a real endpoint.

**`blankComments(text)` must preserve length, newlines and offsets.** Every
line number and match index downstream is computed against the result. Blank a
comment to spaces, not to nothing. Leave ordinary quoted strings alone: that is
where a route path lives. Language constructs that are really comments (a Python
docstring, a JS template literal that could hide a registration) are yours to
blank.

**`importBindings(text)`** answers "which local names did this import bring in",
which is how path derivation narrows a route file's many imports down to the
ones one endpoint actually uses, and how a mount chain finds the module a router
symbol came from. Return one entry per import site.

**`testSubject(path)`** is a naming-convention guess and nothing more:
`test/x.test.ts` → `src/x.ts`. Guessing wrong is safe: the caller checks the
result against the real file set and falls back to token scoring, so return your
convention's answer without verifying it.

### `symbols` is how a barrel gets resolved

`from . import thing` names no module — the imported *symbol* is the module. An
adapter that knows this emits `symbols: ["thing"]` alongside `spec`, and the
pipeline hands it straight back as `resolve`'s fourth argument. `src/adapters/py.mjs`
does exactly that; an adapter that returns only `{ spec }` still works, it just
cannot resolve that shape.

`kind` and `line` are extraction facts the pipeline does not currently read.
Emit them anyway: `kind` is what the conformance table asserts to prove *which*
pattern matched, and `line` is what Phase 7's jump-to-line needs.

**Order is part of the contract.** Return matches in source order — import edges
are emitted in the order extraction produced them and never re-sorted, so this is
what makes two runs of one input byte-identical.

### `ids` is always an array

One specifier can name many files — a Go package, a Java wildcard, a re-export
barrel — so the shape is an array everywhere rather than a special case with a
second code path. Return `["one/file.ts"]` for the ordinary case.

### `kind` is a claim about what you know

| kind | means | `ids` holds |
| --- | --- | --- |
| `internal` | these repo files, definitely | the resolved paths, deduped, in a **deterministic** order — sorted, unless the source order is itself meaningful |
| `external` | a third-party package | the package name, not the full specifier |
| `unresolved` | *I could not place this* | the best diagnostic string you have |

**`unresolved` is a feature.** Resolution here is regex, not an AST, and
under-reporting is the accepted cost — but the cost is only acceptable while the
tool says so out loud. `atlas scan` prints unresolved specifiers grouped by
specifier, which is how a missing alias gets found. Never widen a guess to make
that number look better: a fabricated edge is a lie the whole map inherits, a
missing one is a gap somebody can see.

## What `ctx` gives you

| field | what it is |
| --- | --- |
| `config` | the normalized config (see [config.md](./config.md)) |
| `paths` | every kept file, sorted |
| `fileSet` | `Set` of the same — **membership is how you test a candidate** |
| `src` | `Map<path, text>` of kept files only |
| `dir` | the acquired tree's root on disk |
| `all` | the exclude-filtered walk **before** `keep` — the only way to reach a file `keep` never admits |
| `ctx[yourId]` | whatever your `prepare` returned |
| `progress` | `progress(phase, done, total)` — the scan's own progress line |
| `warn` | one line to stderr |

`dir` and `all` exist because a resolver often needs a file that is not itself
drawn: `tsconfig.json` carries no import edges, so `keep` excludes it, but its
`paths` table decides where dozens of specifiers land. Read those in `prepare`,
once — never per import.

## Rules that are not negotiable

- **Zero dependencies.** Node stdlib, `.mjs` ESM. No compiler, no parser.
- **Regex, not AST.** "Parse harder" is not the answer to a missed pattern —
  skip it, count it, report it.
- **Deterministic.** Two runs of one input must be byte-identical, which is what
  makes the golden diffs meaningful. Sort anything iterated out of a `Set` or an
  object's keys before returning it.
- **Nothing target-specific.** `test/generic.test.mjs` fails on any repo name in
  `src/`. The reviewable question on every line is *would this be right on a repo
  I have never seen?*
- **Blank comments and template literals before matching.** An import inside a
  comment is not an import. `src/adapters/ts.mjs`'s `blank()` is a
  length-preserving scanner, so match offsets still map to real line numbers.

## Adding a language

Start from this skeleton. It claims nothing and extracts nothing, which is
exactly what "this language has no adapter" already behaves like, so it is a
working no-op before it is anything else:

```js
export default {
  id: "go",
  extensions: [".go"],
  extractImports(text) {
    return [];          // -> [{ spec, symbols?, kind, line }]
  },
  resolve(from, spec, ctx) {
    return { kind: "unresolved", ids: [spec] };
  },
  blankComments(text) {
    return text;        // same length, comments spaced out, strings intact
  },
  importBindings(text) {
    return [];          // -> [{ spec, localNames: new Set([...]) }]
  },
  testSubject(p) {
    return p.replace(/_test\.go$/, ".go");
  },
};
```

Register it in `src/adapters/index.mjs`, then copy a fixture.

Note what registering costs you beyond edges: `adapterFor()` is also what endpoint
extraction asks before running a route rule over a file, and what `atlas scan`
reports as unreadable when it answers null. Claiming an extension is claiming the
tool can read that language.

**Start with the fixture, not the regex.** `fixtures/hostile-ts/` and
`fixtures/hostile-py/` are small hand-built repos whose every file exists to
break a naive resolver, and `test/conformance.test.mjs` asserts the **exact**
outcome of every import in them — the specific ids, or `external`, or
`unresolved`. A test that counts resolutions cannot catch a pattern that used to
match and quietly stopped; a table can. Write the table first and let it fail.

Cover, at minimum: the language's re-export barrels, its relative-import syntax
at more than one depth, whatever aliasing its build config allows, one circular
pair, one import that must stay `external`, and — the row people forget — one
that must stay **`unresolved`**.

### Worked example: a Go adapter in 50 lines

`fixtures/hostile-go/` ships in this repo: two Go files and a `go.mod`
declaring the module name (Go has no `keep` extension for `go.mod`, so it is
read from `ctx.all`, the same way `ts.mjs` reads `tsconfig.json`). Run
`node bin/atlas.mjs scan --repo fixtures/hostile-go --ref fs` against it today
and it degrades exactly as "no adapter" should: 0 edges, both files reported
under "no adapter for the language."

```
fixtures/hostile-go/
  go.mod                   // module github.com/example/widget
  widget.go                // package widget
  cmd/main.go              // package main; imports "github.com/example/widget"
```

`cmd/main.go`:

```go
package main

import (
	"fmt"
	"github.com/example/widget"
)

func main() { fmt.Println(widget.Name) }
```

The adapter. One specifier can resolve to many files for a wildcard import,
so `ids` stays an array even though this fixture only ever returns one:

```js
// src/adapters/go.mjs
import path from "node:path";

const IMPORT_BLOCK = /import\s*\(([\s\S]*?)\)/g;
const IMPORT_LINE = /^\s*(?:\w+\s+)?"([^"]+)"/gm;

export default {
  id: "go",
  extensions: [".go"],

  prepare(ctx) {
    const modFile = ctx.all.find((p) => path.posix.basename(p) === "go.mod");
    const text = modFile ? ctx.src.get(modFile) ?? "" : "";
    return { module: text.match(/^module\s+(\S+)/m)?.[1] ?? null };
  },

  extractImports(text) {
    const specs = [];
    for (const block of text.matchAll(IMPORT_BLOCK)) {
      for (const m of block[1].matchAll(IMPORT_LINE)) specs.push(m[1]);
    }
    return specs.map((spec) => ({ spec, kind: "static" }));
  },

  resolve(from, spec, ctx) {
    const mod = ctx.go?.module;
    if (!mod || !spec.startsWith(mod)) return { kind: "external", ids: [spec] };
    // A Go import names a PACKAGE (a directory), not a file. Every .go file
    // in that directory is part of it, which is why this returns an array.
    const dir = spec === mod ? "" : spec.slice(mod.length + 1);
    const ids = ctx.paths.filter((p) => p.endsWith(".go") && path.posix.dirname(p) === dir);
    return ids.length ? { kind: "internal", ids: ids.sort() } : { kind: "unresolved", ids: [spec] };
  },

  // Same length in, same length out: every offset downstream depends on it.
  blankComments(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/\/\/.*$/gm, (m) => " ".repeat(m.length));
  },

  // A Go import binds the package's last segment, or its explicit alias.
  importBindings(text) {
    return this.extractImports(text).map(({ spec }) => ({
      spec,
      localNames: new Set([spec.split("/").pop()]),
    }));
  },

  testSubject: (p) => p.replace(/_test\.go$/, ".go"),
};
```

Register it (`ADAPTERS.push(go)` in `src/adapters/index.mjs`), then add the
expectation table `test/conformance.test.mjs` asserts against:

```js
const EXPECT_GO = {
  "widget.go": [],
  "cmd/main.go": [
    { spec: "fmt", kind: "static", resolved: { kind: "external", ids: ["fmt"] } },
    { spec: "github.com/example/widget", kind: "static",
      resolved: { kind: "internal", ids: ["widget.go"] } },
  ],
};
conform(go, fixture("hostile-go", go), EXPECT_GO);
```

`npm test` now runs this table the same way it runs the TypeScript and Python
ones: exact extraction, exact resolution, no silent regression when a pattern
stops matching. That is the whole contribution surface: nothing in
`src/model/` had to change to pick up a fourth language.
