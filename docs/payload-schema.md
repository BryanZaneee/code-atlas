# Payload schema

`atlas build --json` prints this. It is a public contract: other tools are
expected to read it, so it is versioned from the first release.

- **`meta.schemaVersion`** — integer, currently `2`. Bumped when a field is
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
| `flows` | array | experimental | curated request flows — hand-authored in config |
| `derivedFlows` | array | experimental | flows this tool inferred. **Separate from `flows` on purpose**: a reader has to be able to tell an asserted path from an inferred one without inspecting a field |
| `views` | array | stable | which views the strip offers, derived from the flows present |
| `theme` | object | stable | every colour and style table the viewer draws with |
| `districts` | array | stable | one per `service/layer` pair that has blocks — the cells of the map, where a service row crosses a layer column |
| `findings` | array | experimental | structural findings over the graph — cycles, layering violations, and the rest of `src/model/findings.mjs`'s eight checks |
| `source` | object | experimental | **present only when built with `--embed-source`** — the scanned repository's own text, baked in. See [`source`](#source) |

## Vocabulary

The map's two axes are **service down, layer across**, and every noun below
names something you can point at on it.

| term | what it is | drawn as |
| --- | --- | --- |
| **block** | one source file | an extruded solid; height is file length |
| **district** | one service crossed with one layer | a district plate with a two-character code tab, holding its blocks |
| **service** | a row of the map | a service plate spanning that row's districts |
| **layer** | a column of the map, ordered by `rank` | the column axis; it has no plate of its own |

**Folders are not drawn.** A directory has no visual unit. `nodes[].dir` and the
`dirs:` matcher in layer rules are read to *decide* a block's layer and service,
and after that the directory tree plays no part in the picture. Files that sat
together on disk routinely land in different districts, and that is the map
working rather than failing: it groups by the job a file does, not by where it
was filed.

## `services`

The rows of the map.

| field | type | notes |
| --- | --- | --- |
| `id` | string | referenced by every node's `service` |
| `label` | string | shown on the row plate |
| `lang` `root` | string | detected language, and the directory that defines the row (`null` for a single-package repo) |
| `order` | int | row order |
| `synthesized` | bool | present and `true` when the tool **added** this row because a node claimed a service the config never declared. Dropping those nodes instead would filter them out of the view with no checkbox to bring them back |

## `districts`

| field | type | tier | notes |
| --- | --- | --- | --- |
| `id` | string | stable | `service/layer` |
| `service` `layer` | string | stable | ids into `services` / `layers` |
| `parentId` | string\|null | experimental | the district's parent — the service today. Ships ahead of the nested layout that consumes it |
| `code` | string | experimental | two characters, unique within a payload, stable across scans. The district's name on the map |
| `label` | string | stable | the layer's label |
| `members` | string[] | stable | node ids |

`code` is assigned per **district**, never per file: a repo draws hundreds of
file blocks and hundreds of two-character codes are not a mapping anyone learns.
Assignment runs in sorted `id` order, so adding a file cannot reshuffle the codes
of the districts around it.

## `meta`

| field | type | tier | notes |
| --- | --- | --- | --- |
| `schemaVersion` | int | stable | `2` |
| `suiteCount` | int | stable | distinct test-suite kinds found (unit/integration/…) |
| `repo` | string | stable | basename of the scanned directory |
| `ref` | string | stable | the ref as requested, not resolved |
| `commit` | string | stable | short sha, `""` for an `fs` scan |
| `acquisition` | object | stable | `{mode, ref, commit, dirty}` — see below |
| `generatedAt` | string | stable | `YYYY-MM-DD HH:MM UTC` |
| `nodeCount` `fileCount` `lineCount` `edgeCount` `docCount` `endpointCount` `testCount` | int | stable | `fileCount`/`lineCount` count code files only, excluding markdown |
| `coverDirect` `coverIndirect` `coverNone` | int | stable | node counts per coverage state |
| `packageCount` | int | stable | distinct external packages across all nodes |
| `unsortedCount` `unresolvedCount` `derivedCount` | int | stable | what the tool could not account for — see below |

### The map's own coverage

Three counters the UI keeps in the permanent frame rather than in a panel,
because they are the tool's central caveat.

| field | counts |
| --- | --- |
| `unsortedCount` | files no layer rule matched, placed by the fallback — their `layerWhy` begins `no rule matched` |
| `unresolvedCount` | import specifiers the adapter could not resolve to a file or a package |
| `derivedCount` | flow steps **not** backed by an observed import edge |

`derivedCount` does not distinguish curated from derived paths, and must not:
both model an ordering that imports cannot express, and neither was observed.

### `meta.acquisition`

How the source was read, because it decides whether the picture is reproducible.

| `mode` | meaning | `dirty` |
| --- | --- | --- |
| `ref` | `git archive <ref>` into a temp dir | `false` — a commit is immutable |
| `worktree` | the working tree as it sits | `true` when uncommitted changes exist |
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
| `serviceWhy` `layerWhy` | string | stable | why it landed in this service/layer, in prose — `matched rule #4 — a service directory` for a file, a fixed sentence for an endpoint or a datastore, since neither is placed by a rule. INSPECT shows it |
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
| `why` | string | experimental | endpoint nodes only — which registration rule matched and where its mount prefix came from, e.g. `matched endpoint rule #0 /router\.(get\|post)…/ · prefix "/api" from the mount chain` |
| `travelledBy` | string[] | experimental | ids of the flows passing through this node. **Absent**, not empty, when no flow does |

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
| `line` | int | stable | 1-based line in `from` declaring the import; what jump-to-line opens. `kind: "import"` only — a target imported on several lines gets its first occurrence in file order; other kinds never carry it |
| `note` | string | experimental | present on curated edges |
| `flow` | string | experimental | the flow that contributed the edge |

Deduplicated by `from|to|kind`, so one pair can carry several edges of different
kinds. Self-edges are dropped.

## `endpoints`

| field | type | tier | notes |
| --- | --- | --- | --- |
| `id` | string | stable | `"METHOD /path"`, suffixed ` · service` only on a genuine collision |
| `method` | string | stable | uppercase |
| `path` | string | stable | **literal**, mount prefix applied — see below |
| `service` | string | stable | service id |
| `definedIn` | string | stable | the file declaring it |
| `line` | number | stable | 1-based line the route is declared on; what jump-to-line opens |
| `derivedPath` | object | `{ steps }` — the modelled path in, and back out of, this endpoint. Node **indices**, not ids. See [`derivedFlows`](#derivedflows) |

**`path` is the source's own text, never rewritten.** `:id` and `{id}` are the
same logical param in two frameworks' syntax and collapse onto one node, but
that collapse happens in the identity key — the path you are shown is the one
the file actually declares. Rewriting it would silently break a curated flow
that references an endpoint by its literal id.

**A mount prefix is discovered, not assumed.** Where a config rule declares a
`mount`, that wins. Otherwise the prefix comes from following
`app.route(prefix, router)` registrations across files to a fixpoint, because a
path assembled from three files appears in none of them.

**A non-literal route path is never emitted.** A phantom endpoint is worse than
a missing one, so a registration the extractor cannot read literally is skipped
and counted rather than guessed at. Two shapes are counted: a call whose path is
not a string literal, and a literal path handed to a helper inside a file that
is mounted as a router, where the method lives in code this tool does not
follow. `atlas scan` prints them grouped by file. The list is **not** part of
the payload — it rides on the returned array as a non-index property, which
`JSON.stringify` ignores.

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

## `views`

One entry per view in the strip. Derived from the scan, not declared, so a repo
whose flows are named anything at all still gets its flow views — the viewer
branches on `kind`, never on an id.

| field | type | notes |
| --- | --- | --- |
| `id` | string | `structure`, `tests`, `findings`, `derived`, or one per distinct `flows[].view` |
| `label` | string | what the strip shows |
| `kind` | string | `structure` \| `flow` \| `tests` \| `findings` — **the only thing the viewer branches on** |
| `title` `hint` | string | heading and explanatory line; config may override |
| `showPhase` | bool | present on a flow view whose flows carry `phase` |
| `derived` | bool | present and `true` on the derived-paths view |

The `structure` and `tests` views are always present, and so is `findings` —
**including when `findings` is empty**. A repository with nothing wrong with it
has a result to report, and dropping the view would make "eight checks ran and
matched nothing" indistinguishable from "this tool does not check". The
derived-paths view is the one conditional entry: it appears only when there are
derived paths to play.

## `theme`

Colour and style tables, shipped rather than hardcoded because canvas cannot read
CSS custom properties. Scalars: `ink`, `bg`, `face`, `packetLabel`, `accent`,
`plate`, `edge`, `layerFallback`, `font`. Tables: `edgeStyle`, `packetColor`,
`coverTint`, `findingSeverity`, `legend`. `dark` is a **delta** over the scalars,
plus `findingSeverity` — the one table it carries, because a severity ring is
drawn over a veiled city and a deep red disappears into a near-black ground.
Config may replace any branch; see [config.md](./config.md).

## `derivedFlows`

The same shape as `flows`, produced by `src/model/derive.mjs` instead of by a
person, one per endpoint. Every entry carries `derived: true` and a `blurb`
saying so.

Steps carry two extra fields that `flows` steps do not:

| field | type | notes |
| --- | --- | --- |
| `certainty` | string | `wired` — a mount registration this tool read; `imported` — an import edge justifies the hop; `inferred` — a gap, admitted |
| `inferred` | bool | `certainty === "inferred"`, as a boolean for the renderer |

`endpoints[].derivedPath` is the same path attached to the endpoint it belongs to,
with `from`/`to` as **integer node indices** rather than ids — the top-level
`derivedFlows` array is the id-bearing form. Both describe one derivation.

> **These are inferences, not observations.** See the table at the end of this
> document. A consumer that renders them identically to `edges` is making a claim
> the scanner did not.

## `findings`

`atlas findings --json` prints this array. Every entry is structural — no
style opinions, nothing that needs an AST (PLAN.md, "Findings engine") — and
is computed from the graph, coverage and derived paths this same payload
already carries; nothing here is a second analysis pass over source.

| field | type | notes |
| --- | --- | --- |
| `id` | string | deterministic — same input, same id. What a config's `findings.mute` names to silence a finding |
| `type` | string | `cycle` `layering` `oversized-file` `untested-endpoint` `orphan` `unreachable` `god-node` `cross-service` |
| `severity` | string | `info` \| `warning` \| `error` |
| `message` | string | one line, naming the exact ids involved |
| `why` | string | one line — why this finding matters, not what it is |
| `evidence` | object | `{ nodes: string[], edges: {from,to,kind}[] }` — the exact node/edge ids implicated, for a renderer to highlight in place. Never a prose description. The viewer's findings view draws exactly this: the named blocks and edges at full strength, the rest of the map dimmed rather than removed |
| `muted` | bool | `true` when `findings.mute` in config names this finding's `id` |
| `muteReason` | string\|null | the reason given alongside it, or `null` when not muted |

**Muting never removes a finding from the array.** It only stamps
`muted`/`muteReason` — the finding stays visible, which is what keeps
`atlas findings --json` a complete account of what was found rather than a
list a config can quietly shrink. A consumer wanting only the live findings
filters on `!f.muted`.

Each finding type is total by construction (CLAUDE.md, "Graceful degradation")
and several report **nothing** rather than a false claim when their basis is
not measured for a given repository: `untested-endpoint` when no coverage was
measured at all (no tests, or none an adapter could resolve), `unreachable`
when no `entry`-layer node exists to measure reachability from. Thresholds —
`locThreshold`, `godNodePercentile`, `minGodInDegree`, `orphanRoots`, `mute` —
are config; see [config.md](./config.md#findings).

## `source`

Absent by default. `atlas build --embed-source [glob]` adds it, and the
consequence is exactly what the field name says: the shareable HTML this
produces then contains that source text. The viewer's SOURCE panel reads it
through the same `SRC.cache` a live `atlas serve` read fills, and the footer
legend's `SOURCE EMBEDDED` badge is driven by this field being present — it is
never omitted or downplayed when the field is here.

| field | type | notes |
| --- | --- | --- |
| `glob` | string \| null | the glob `--embed-source` was given, or `null` for the whole scanned set |
| `gzip` | bool | `true` when `--gzip-source` compressed `files` into `blob` below |
| `paths` | string[] | every embedded path, sorted — present either way, and never compressed, so the viewer can answer "is this file embedded" and count files for the footer badge without inflating anything |
| `files` | object | **present when `gzip` is `false`.** repo-relative path -> file text |
| `blob` | string | **present when `gzip` is `true`.** one base64 gzip stream covering every embedded file's text together (`JSON.stringify(files)`, then gzip, then base64) — one shared blob rather than one gzip stream per file, so files that resemble each other actually help compress one another instead of paying a separate header each |

`paths`/`files` are keyed from the same `paths`/`fileSet` `collect()` produces
for `atlas serve`'s allowlist — the same filter, so the embedded set and the
map agree by construction — narrowed by `glob` when one was given, using the
glob syntax `src/model/tests.mjs`'s `globToRe` already implements (`*` within a
segment, `**/` for any depth). Order follows `collect()`'s sorted `paths`,
which is what keeps two builds of the same input byte-identical.

A file the glob excluded is not an error: the SOURCE panel says specifically
that this file was not embedded, distinct from a file that could not be read
at all. If a live `atlas serve` is also present for the page (uncommon, since
these flags are `build`-only), embedded text is preferred — it is guaranteed
complete for what it did embed, where a live fetch depends on a server that a
plain static file has no way to promise — and the server is asked only for a
path the glob left out.

## What is observed and what is modeled

The payload mixes both, and keeping them apart is the tool's central claim.

| observed | modeled |
| --- | --- |
| files, directories, `loc` | the internal path a request takes |
| import edges (regex; under-reports) | |
| endpoints and their mount prefixes | |
| live HTTP status and latency *(phase 9)* | |

Per-hop timing is **never** present, in any field, because it is not measured.
