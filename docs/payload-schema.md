# Payload schema

`atlas build --json` prints this. It is a public contract: other tools are
expected to read it, so it is versioned from the first release.

- **`meta.schemaVersion`** — integer, currently `1`. Bumped when a field is
  removed, renamed, or changes meaning. Adding a field does **not** bump it, so
  read defensively and ignore what you do not know.
- **`meta.generatedAt` is the only field allowed to differ between two runs of
  the same input.** Everything else is deterministic — that is what makes the
  golden files, and every regression diff built on them, mean anything.
- **Stability tiers.** `stable` fields will not change without a version bump.
  `experimental` fields may change or disappear within a version; do not build
  on them yet.

## Top level

| field | type | tier | notes |
| --- | --- | --- | --- |
| `meta` | object | stable | counts and provenance, below |
| `services` | array | stable | rows of the map, in `order` |
| `layers` | array | stable | columns of the map, in `rank` |
| `nodes` | array | stable | files, datastores and endpoints |
| `edges` | array | stable | directed, deduplicated by `from|to|kind` |
| `endpoints` | array | stable | the HTTP surface |
| `flows` | array | experimental | curated request flows; Phase 6 adds derived ones |
| `groups` | array | stable | one per `service/layer` pair that has members |

## `meta`

| field | type | tier | notes |
| --- | --- | --- | --- |
| `schemaVersion` | int | stable | `1` |
| `repo` | string | stable | basename of the scanned directory |
| `ref` | string | stable | the ref as requested, not resolved |
| `commit` | string | stable | short sha, `""` for an `fs` scan |
| `acquisition` | object | stable | `{mode, ref, commit, dirty}` — see below |
| `generatedAt` | string | stable | `YYYY-MM-DD HH:MM UTC` |
| `nodeCount` `fileCount` `lineCount` `edgeCount` `docCount` `endpointCount` `testCount` | int | stable | `fileCount`/`lineCount` count code files only, excluding markdown |
| `coverDirect` `coverIndirect` `coverNone` | int | stable | node counts per coverage state |
| `packageCount` | int | stable | distinct external packages across all nodes |

### `meta.acquisition`

How the source was read, because it decides whether the picture is reproducible.

| `mode` | meaning | `dirty` |
| --- | --- | --- |
| `ref` | `git archive <ref>` into a temp dir | `false` — a commit is immutable |
| `worktree` | the working tree as it sits *(phase 2)* | `true` when uncommitted changes exist |
| `fs` | a plain directory walk, no git | `null` — unknowable |

A `worktree` or `fs` scan includes uncommitted work and therefore cannot be
reproduced from any commit. The UI surfaces this: a screenshot you can trust and
one you cannot are otherwise indistinguishable.

## `nodes`

Three kinds share one array. `kind` says which, and some fields are only present
on some kinds.

| field | type | tier | notes |
| --- | --- | --- | --- |
| `id` | string | stable | repo-relative path, or `db:*`, or `"METHOD /path"` |
| `name` | string | stable | basename, or the label / endpoint id |
| `dir` | string | stable | parent directory; for an endpoint, its defining file |
| `service` `layer` | string | stable | ids into `services` / `layers` |
| `serviceWhy` `layerWhy` | string | stable | the rule that placed it, in prose — `matched rule #4 — a service directory`. File nodes only; INSPECT shows it |
| `lang` | string | stable | `ts` `py` `sql` `md`, or `-` for non-files |
| `loc` | int | stable | lines, trailing newline not counted |
| `kind` | string | stable | `file` · `datastore` · `endpoint` |
| `exports` | int | experimental | regex count of `export` / `def` / `class` |
| `externals` | string[] | stable | external packages imported, sorted |
| `testKind` | string\|null | stable | `unit` `integration` `pact` `e2e`, tests only |
| `subject` | string\|null | experimental | the node a test primarily covers |
| `inDeg` `outDeg` | int | stable | edge degree |
| `coverage` | string\|null | stable | see below. **Absent** on non-file nodes |
| `uncovered` | bool | stable | `coverage === "none"` |
| `note` | string | experimental | datastore nodes only |

### `coverage`

Derived from **imports, not execution** — there is no coverage tool in the loop.

| value | meaning |
| --- | --- |
| `direct` | a test imports it |
| `indirect` | reachable through the import graph from something a test imports |
| `none` | no test reaches it — the only value that means *untested* |
| `null` | not measured: tests, tooling, docs and migrations |

The three states exist because a route test imports the app factory rather than
the router, so "no test imports this" is not the same as "untested". A bare
uncovered flag would libel well-tested files.

## `edges`

| field | type | tier | notes |
| --- | --- | --- | --- |
| `from` `to` | string | stable | node ids; both always resolve |
| `kind` | string | stable | `import` `http` `sql` `cache` `s3` `coupling` `request` `response` `read` `write` `test:subject` `test:exercises` |
| `cross` | bool | stable | crosses a service boundary, ignoring `infra` |
| `note` | string | experimental | present on curated edges |
| `flow` | string | experimental | the flow that contributed the edge |

Deduplicated by `from|to|kind`, so one pair can carry several edges of different
kinds. Self-edges are dropped.

## `endpoints`

| field | type | tier | notes |
| --- | --- | --- | --- |
| `id` | string | stable | `"METHOD /path"`, suffixed ` · service` only on a genuine collision |
| `method` | string | stable | uppercase |
| `path` | string | stable | literal, mount prefix applied |
| `service` | string | stable | service id |
| `definedIn` | string | stable | the file declaring it |

**A non-literal route path is never emitted.** A phantom endpoint is worse than
a missing one, so a registration the extractor cannot read literally is skipped
and counted rather than guessed at. Phase 4 reports those counts.

## `flows`

Hand-authored, because static imports cannot express request **ordering**. Every
`from`/`to` is validated against the scanned node set, so a rename fails loudly
instead of drawing a chain that is not there.

| field | type | notes |
| --- | --- | --- |
| `id` `label` | string | identity and display |
| `view` | string | which view shows it |
| `phase` | string | optional grouping within a view |
| `blurb` | string | prose shown in the panel |
| `steps` | array | `{from, to, kind, label?, note?, sample?}` |

`sample` payloads are synthetic placeholders and carry no real data.

## What is observed and what is modeled

The payload mixes both, and keeping them apart is the tool's central claim.

| observed | modeled |
| --- | --- |
| files, directories, `loc` | the internal path a request takes |
| import edges (regex; under-reports) | |
| endpoints and their mount prefixes | |
| live HTTP status and latency *(phase 9)* | |

Per-hop timing is **never** present, in any field, because it is not measured.
