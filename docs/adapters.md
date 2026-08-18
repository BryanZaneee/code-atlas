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
};
```

Register it in `src/adapters/index.mjs`. `adapterFor(path)` picks the **first**
adapter whose `extensions` match, so the list order is the tie-break.

| member | contract |
| --- | --- |
| `id` | unique; also the key `prepare`'s return value is stored under on `ctx` |
| `extensions` | the file suffixes this adapter claims. A path no adapter claims yields no edges — a supported outcome, not a failure |
| `prepare(ctx)` | optional, called **once** before extraction. Return whatever per-repo state resolution needs; it lands on `ctx[id]` |
| `extractImports(text, from, ctx)` | → `[{ spec, kind, line }]`. One entry per import *site*, not per unique specifier |
| `resolve(from, spec, ctx, symbols)` | → `{ kind, ids }` where `kind` is `"internal"`, `"external"` or `"unresolved"` |

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

`src/adapters/generic.mjs` is the skeleton: it claims nothing, extracts nothing,
and is what "this language has no adapter" already behaves like. Copy it, and
copy a fixture.

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
