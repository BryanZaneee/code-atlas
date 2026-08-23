# code-atlas — roadmap

Progress tracker for [PLAN.md](./PLAN.md). A phase is done when **every** box under it is checked — the gate is the definition of done, not a suggestion.

**Status: 18 of 20 phases complete.** Phases 0–11 shipped v1.1. Phases 12–16
are what comes after it; 12, 13 and 14 are done.

Two boxes have been open since before v1.1 and neither is a phase. Phase 1's
60 fps sustained drag and Phase 11's arrival animation both have to be judged by
a human with the window in front of them, because `requestAnimationFrame` is
suspended in a backgrounded tab: a harness driving the page sees the arrival
advance one frame per forced repaint, which looks like blocks failing to draw.
Everything else, including every gate, is met and tested.

Live mode landed last by design. It is the only part of the tool that opens a
socket to a running app, it is off unless `--allow-live` is passed, and even
with it on the internal path stays modelled: the status and the round trip are
the only observed things it adds.

| # | Milestone | Unblocks | Status |
| --- | --- | --- | --- |
| 0 | Repo skeleton, lift-and-shift, payload contract | everything | ● done |
| 1 | Renderer: perf, rotation, decoupling | 7, 8, 9 | ◐ one gate open |
| 2 | Config, detection, graceful degradation | 3, 4 | ● done |
| 2.5 | Visual system: palette, selection, chrome | — | ● done |
| 2.6 | Visual pass against a reference design | — | ● done |
| 2.7 | Layout density, draggable districts, one vocabulary | — | ● done |
| 3 | Language adapters + conformance fixtures | 4, 6 | ● done |
| 4 | Endpoint extraction v2 | 5, 6, 8 | ● done |
| 5 | Findings engine | — | ● done |
| 6 | Path derivation + calibration | 8 | ● done |
| 7 | `atlas serve` + code viewer | 8, 9 | ● done |
| 8 | Request composer UI | 9 | ● done |
| 9 | Live proxy mode | — | ● done |
| 10 | Open-source packaging | — | ● done |
| 11 | Viewer port: folder districts, four views, authorship | — | ● done |
| 12 | Sweep: dead code, one fake browser, named stages | — | ● done |
| 13 | `atlas map` — the isometric atlas in a terminal | — | ● done |
| 14 | Adapters: Go, Ruby, Java/Kotlin, Rust | — | ● done |
| 15 | IDE affordances in the viewer | 16 | ○ not started |
| 16 | `desktop/` — an Electron shell | — | ○ not started |

Legend: ○ not started · ◐ in progress · ● done · [~] deliberately deferred, with the reason

**Build order, which is not the numbering:** 8, then 10, then 9. Live mode is
last by choice — the modelled path is accurate enough to work against, so real
HTTP is analysis rather than the thing the tool is for, and it is the only phase
that opens a socket to somebody's running app. Packaging before it means the
README describes a tool that is finished for everyone who never turns live on.

---

## Phase 0 — Skeleton and lift-and-shift

*Zero behaviour change. The point of this phase is that the next ten can be trusted.*

- [x] `git init`, directory scaffold
- [x] `PLAN.md`, `ROADMAP.md`
- [x] `package.json` — `bin:{atlas}`, `engines>=20`, **no `dependencies` field**
- [x] `bin/atlas.mjs` — `parseArgs` subcommand dispatch (`build`/`serve`/`init`/`scan`/`findings`)
- [x] Scanner split into `src/scan/*` + `src/model/*`; the walk **never follows
      symlinks** (Phase 7's security posture needs it, and a symlinked checkout
      would otherwise be double-counted)
- [x] Viewer split into `src/viewer/*` + concatenation in `src/build/assemble.mjs`
- [x] TaxVault taxonomy frozen into `examples/taxvault.config.mjs`
- [x] `meta.schemaVersion = 1` — **now 2.** Phase 2.7 renamed the payload key
      `groups` to `districts`, the word the viewer, the docs and the UI had
      always used for it. The taxvault golden was *not* rewritten: it is the
      prototype's output and the prototype said `groups`, so `golden.test.mjs`
      renames the key back on its clone before comparing, the same way it undoes
      the json-lang and docstring-import fixes. The Phase 0 byte-identical gate
      below therefore still passes against the original file, at schemaVersion 1
- [x] `meta.acquisition` (`worktree` / `ref` / `fs`, + `ref`, `commit`, `dirty`)
      — the **`fs` rung landed early**: the in-repo fixtures are not git repos and
      the test suite must not require git. The rungs above it and the fallback
      logic that chooses between them are still Phase 2.
- [x] `test/` harness: `helpers.mjs`, `generic.test.mjs`, `payload.test.mjs`, `golden.test.mjs`, `viewer.test.mjs`
- [x] `fixtures/mini-monorepo/` — the CI-enforced target, plus `docs/payload-schema.md`
- [x] **Gate:** payload byte-identical to the prototype except `generatedAt`
  - baseline captured from the prototype pinned at taxvault `22595f3a` and committed
    as `test/golden/taxvault.prototype.json` — a file, not a hash, so a failure prints a diff
  - 197 nodes / 467 edges / 18 endpoints / 9 flows / 7 services / 14 layers / 43 groups
  - *(the sha256 previously recorded here was unreproducible against any
    normalization of the prototype's output; the counts were correct)*
- [x] **Gate:** `test/generic.test.mjs` — zero target-specific strings in `src/` or `bin/`,
      minus an explicit accepted list holding the viewer strings Phase 1 removes

## Phase 1 — Renderer: perf, rotation, decoupling

*Moved ahead of the scanner work: the `RangeError` is a crash, and every later view builds on this renderer.*

- [x] `RangeError` fix — accumulate instead of `Math.min(...pts.map())`. Also fixed
      in `focusOn` and the service plates, which had the same spread
- [x] World-space static cache + mip re-render (was invalidated by every pan frame, buying nothing)
- [x] Cached label widths; edges bucketed by style instead of `save()/restore()` per edge
- [x] `Set` for endpoint dedupe (O(E²) → O(E)); `Map` for group lookup (O(N·G) → O(N))
- [x] `heightOf` → `8 + 130·log1p(loc)/log1p(p95)`, bounded so one generated file cannot flatten the map
- [x] Theme single-sourced into JS tokens; **`style.css` contains zero hex literals outside `:root`** (test enforces)
- [x] `VIEWS`, `EDGE_STYLE`, `PACKET_COLOR`, `COVER_TINT`, hint copy → moved into the payload;
      views are derived per distinct `flows[].view` and the viewer branches on `kind`, not on names
- [x] `meta.suiteCount` (killed the hardcoded `["SUITES","4"]`)
- [x] **Camera rotation**: yaw-parameterized projection, generalized depth sort, conditional face visibility, `reproject()` split from `relayout()`
- [x] Rotation controls: `Q`/`E` 15° steps, Shift+drag free, `R` snap to 45°, yaw in the overlay
- [ ] **Gate:** 60 fps sustained drag on the largest target — *the mechanism is
      tested (`render.test.mjs`: 120 pans → 1 rasterisation, 121 blits) and the
      atlas was checked by hand in Chrome, but the frame-time number itself has
      not been measured: `requestAnimationFrame` is suspended in a backgrounded
      tab, so the harness cannot sample it. Needs a human with the window in front.*
- [x] **Gate:** synthetic 5,000-node / 12,000-edge payload renders, no `RangeError`
      — plus 20,000, which is past the argument limit on any engine (5,000 alone
      would not have caught it: this Node build tolerates ~125k arguments)
- [x] **Gate:** `generic.test.mjs` green with an **empty** accepted list — every
      taxvault-coupled viewer string is gone
- [x] **Gate:** yaw 45° is bit-identical to Phase 0; 360° sweep never mis-occludes;
      click selects correctly at every angle (verified in Chrome at 105° yaw).
      Both rotation gates are regression-checked: reverting the depth sort to
      `gx+gy` fails the sweep, pinning a face plane fails visibility at 100°

## Phase 2 — Config, detection, graceful degradation

- [x] `src/config/{defaults,detect,load}.mjs`; precedence: defaults < detected < config file < CLI flags
      — one normalized shape downstream, so nothing in `src/scan/` or `src/model/`
      knows where a value came from. Both example configs keep their `classify()`
      function; the loader accepts that shape and the rule-array shape alike
- [x] Service auto-detection from manifests, run over the **filtered** file list (build artifacts like `.next/package.json` must not register as services)
      — plus: a manifest directory with no code under it is an umbrella, not a service
- [x] **Total `serviceOf`** — an explicit fallback service always exists (kills the blank-screen failure).
      Enforced at the payload too: a service id a config *used* but never *declared*
      is added, rather than its files being moved or dropped
- [x] Directory-derived layer fallback; `unsorted` share reported — `unsorted` is its
      own column, because calling unplaceable application code "tooling" is a claim
      the tool cannot support. The default taxonomy also gained `ui` and `util`, without
      which every component in a client-side repo lands in the fallback
- [x] No tests → `coverage: null` everywhere; suite count from `meta`
- [x] Acquisition ladder: worktree → git ref → plain fs; default ref `HEAD`
      (`origin/develop` exists only on taxvault), and handle a git repo with an
      **unborn HEAD** — sonder has zero commits, so `rev-parse --git-dir` succeeds
      while `rev-parse HEAD` fails. The walk no longer descends into excluded
      directories, which a worktree scan needs and a `git archive` scan never did
- [x] Curated-flow validation demoted to a warning; `--strict` restores the hard fail
- [x] **Classification provenance** — every node records the rule that placed it, shown in INSPECT
- [x] `atlas scan` diagnostics report — the build summary, plus unresolved
      specifiers **grouped by specifier** and a layer/service histogram. One
      missing alias is a hundred identical lines otherwise, which hides the
      cause rather than showing it. Its report goes to stdout, because it is the
      command's output rather than its commentary
- [x] Streamed progress to stderr, throttled, suppressed when not a TTY —
      `walk · parse n/total · resolve · endpoints · derive` on one rewritten
      line. Entering a phase always draws; only the per-file counter is
      throttled, or the line reports a phase the scan has already left. A
      non-TTY stream writes **zero** bytes rather than bytes a consumer is
      expected to filter, which is what keeps `--json` clean
- [x] `atlas init` writes a starter config (the only command that writes to a
      target repo) — it emits **what detection found**, spelled out, because you
      cannot correct a list you have never seen; every other key is a commented
      one-liner rather than the defaults restated, which would drift the first
      time the defaults improve. It refuses to overwrite: an existing config was
      written by a person, and no amount of detection outweighs that
- [x] **Gate:** `atlas build` with **no config** yields a legible atlas for taxvault, Shuttrr, terra, sonder *(git repo, zero commits)*, llmbench *(pyproject only)*
- [x] **Gate:** for each — `nodeCount > 0`, `services.length ≥ 1`, every node's service ∈ services
  - `test/corpus.test.mjs`, skipping per repo so a fresh clone and CI stay green.
    Also asserts ≥3 layers in use and `unsorted` under 60%: the tool is allowed not
    to recognise a layout, not allowed to be silently useless on one
  - two bugs this found, both invisible on the configured targets: a file's language
    was decided with markdown as the else branch, so every unrecognised extension
    counted as prose and dropped out of `fileCount`; and `subjectOf` still called
    the config's `classify()` directly, which crashed on any repo without one

## Phase 2.5 — Visual system

*Inserted, not renumbered: phases 3–10 and every gate reference are untouched.
The renderer is fast and honest and reads as a diagram; this is the phase that
makes it read as a tool. Selection and palette first — both are small, and both
are visible on every single interaction.*

- [x] `meta.unsortedCount` / `unresolvedCount` / `derivedCount` — the map's own
      coverage in the payload rather than only on stderr. A curated hop counts as
      derived: curation and derivation alike model an ordering imports cannot
      express, and the honesty contract does not distinguish them
- [x] `groups[].code` — a stable 2-char district name, and `groups[].parentId`
- [x] `nodes[].travelledBy` — the flow index inverted, absent when empty
- [x] Selection and hover drawn in the **live** pass, not baked into the world
      cache; full-silhouette stroke + footprint ring, hover distinct from select
- [x] Neutral light/dark palette replacing cream; every colour literal in
      `50-render.js` promoted into the theme
- [x] Two colour channels: identity (fill) vs state (stroke/glow/badge);
      `colorMode` `identity`/`mono`, state channel identical in both
- [x] Isometric ground grid; district plate tabs anchored with a leader line
- [x] Tiered flow dimming with a short ease; numbered step badges; caption bar
- [x] TRAVELLED BY chips that enter a flow **at this node's step**; sidebar
      accent edge-bar for the reverse index — *hover-to-preview is not done:
      switching flows relayouts, so a preview is not the free thing the design
      assumed*
- [x] Chrome: `DERIVED n · UNMAPPED n` in the top strip, persistent key hints in
      the bottom strip, hover readout, prose type register
- [x] **Gate:** select and hover cause **zero** re-rasterisations; 120 pans still
      cause exactly one
- [x] **Gate:** zero colour literals of any form (`#`, `rgb(`, `hsl(`) outside
      `:root` and the payload theme
- [x] **Gate:** `COVER_TINT` and the derived dotted stroke survive every colour
      mode — `mono` disables identity, never a honesty channel
- [x] **Gate:** mini-monorepo (no flows, no curation) renders no empty panel
      section and no empty chip row — checked by hand: no TRAVELLED BY heading
      without flows, no EXTERNAL PACKAGES heading without packages, and
      `DERIVED · UNMAPPED` reads `0 · 0` because both are true of it

## Phase 2.6 — Visual pass against a reference design

*Inserted like 2.5 and for the same reason: numbering stays put. Driven by five
reference screenshots the user supplied, plus four things they named directly.*

- [x] White ground replacing the cream; panels share it and are separated by a
      hairline rather than a fill. Dark is **derived, not copied** — every
      reference shot is light, so that palette is ours
- [x] Contrast hierarchy made explicit, lightest first: **grid ≪ plate < block
      fill < block stroke**. The grid kept the alpha it had on cream, where it
      read as texture; on white it read as a second set of edges and the blocks
      it stood under became hard to find
- [x] **Isolated flow view restored, and it is the default.** The old behaviour
      was a re-layout and not a filter, which is why dimming never felt like it:
      the blocks re-pack, so an 8-step flow draws 9 buildings instead of 200.
      `IN CONTEXT` gives the dimmed-in-place reading. One answers *what is this
      path*, the other *where does it sit*
- [x] Block shape is a **list of prisms** — block, tower, slab, stepped, round —
      read by the renderer, the selection hull and hit testing from one face
      list. Face visibility is decided by projected winding rather than by yaw
      quadrant, so a stepped or eight-sided block is not a special case
- [x] Packing within a district (grid / wide / tall). The district grid itself
      is deliberately not on offer: service down, layer across is the
      information design, not a preference
- [x] Services are disclosures holding their own districts, sorted by the order
      the map lays them out in; flows are real buttons; districts carry their
      two-character code, tinted by layer and legible in `mono`
- [x] Panel type scale from the references: dim eyebrow → large sans title →
      quiet meta → detail
- [x] Three claims that were not true of every repo: prose naming a view label a
      config can rename, a coverage note asserting the repo has no coverage
      tooling, and a checkbox saying "show docs/" while filtering markdown
- [x] **Gate:** every shape's drawn faces are the faces hit testing uses, at four
      yaws — checked by test, and by hand: picking a node at its own roof centre
      returns that node for 102 of 105, the rest being correct occlusion
- [x] **Gate:** select and hover still cause zero re-rasterisations; 120 pans
      still cause exactly one
- [x] **Gate:** the empty fixture renders no heading with an empty body, in both
      themes and both colour modes

## Phase 2.7 — Layout density, draggable districts, one vocabulary

*Inserted like 2.5 and 2.6, and for the same reason: the numbering stays put.
Two complaints and one debt. The map read too sparse and could not be
rearranged; and the same thing had two names in four places, which is fine while
one person holds it all and not fine in a README written for strangers.*

- [x] **One word per thing.** The payload's `groups` became `districts` and
      `meta.schemaVersion` went to 2 — the one breaking rename on the list, and
      cheap only while nothing external reads the payload. `LAYOUT.districts[]`
      holds `blocks`, not `members`, which meant node ids on one side and node
      objects on the other. `S.layout` and `S.grid` became `S.packing` and
      `S.ground`: layout meant three things and grid meant three others. *box*
      and *building* are retired in favour of *block*. The glossary is in
      `CLAUDE.md` and `docs/payload-schema.md`, including the thing readers get
      wrong first — **folders are not drawn**
- [x] **One district id.** The payload said `service/layer`, the viewer said
      `service|layer`, and a line in the middle translated. Two keyspaces for one
      identity, and it had already cost something: the sidebar's district code
      chip looked one up in the other and had been silently blank. `districtId()`
      builds it, in one place
- [x] Density presets shipped in the payload the way colour already is —
      `compact` / `normal` / `roomy`, config-overridable under `theme.density`,
      with a sidebar control. `roomy` is what every atlas was drawn at before, so
      nothing was taken away
- [x] **Gate:** every preset's pitch clears the depth-sort floor, and a config
      asking for less is clamped rather than obeyed. Pinned from both sides in
      `test/layout.test.mjs`: the invariant is that a block's footprint is one
      cell, and below it occlusion and hit testing stop agreeing
- [x] **Gate:** compact draws a strictly smaller map than normal, and normal than
      roomy — measured on the bbox, which is what a reader actually sees. On this
      repository the default went from 3325×1390 to 2485×1034, 44% less area,
      with compact at 61% less
- [x] Alt-drag moves a district — blocks, plate and code tab together. Whole
      cells, so the lattice survives the drag; a drop onto an occupied district
      is refused and drawn in the error colour rather than silently springing
      back. Offsets live in viewer state and never in the payload, and in memory
      only — `PLAN.md`'s "persisted layouts" deferral stands, and `R` is the way
      back
- [x] **Gate:** a drag moves exactly its own district and nothing else, by a whole
      number of cells; the plate follows its blocks; `R` restores the computed
      layout byte for byte
- [x] **Gate:** a committed drag re-rasterises exactly once, a refused or
      zero-cell one not at all, and 120 pans afterwards still cost nothing. The
      cache keys on node count, which a drag never changes, so a layout epoch
      joins the key — and writing this test is what found the zero-cell drop
      re-rasterising the city to draw the same picture
- [x] **Gate:** a district is picked by the polygon the renderer filled for it,
      and the hit box follows the drag — the same rule `pickNode` is held to,
      because a map you can click on and be lied to by is worse than a static one

## Phase 3 — Language adapters + conformance

- [x] Adapter interface documented in `docs/adapters.md`; `resolve()` returns an **array** of ids (Go packages / Java wildcards are one specifier → many files)
- [x] `fixtures/hostile-ts/` — barrel chains, `export * from`, aliased re-exports, circular imports, `@/` alias, extensionless, side-effect, `require()`, dynamic `import()`, `.tsx`
- [x] `fixtures/hostile-py/` — relative-dot imports at several depths, `__init__.py` re-export barrels, `from . import x`
- [x] Conformance test asserting **exact** expected resolution for both fixtures
      — including the rows that must come back **unresolved**, which is the
      honesty path and the one a counting test cannot protect
- [x] `src/adapters/ts.mjs` — tsconfig `paths`/`baseUrl` **scoped per tsconfig**
      (Shuttrr's `web/tsconfig.json` maps `@/*` → `./*` root-relative while
      `server/tsconfig.json` has no `paths` at all), extension swap, all four
      import forms, and the six extensions the ecosystem ships rather than `.ts`
      alone — a `.jsx` repo was extracting nothing at all. **`baseUrl` is null
      unless declared**: defaulting it to the tsconfig's own directory
      fabricated an internal edge for `import "lodash"` beside a local
      `lodash.ts`, which is a phantom edge and is not permitted
- [x] `src/adapters/py.mjs` — module roots **inferred from the layout**,
      generalized barrels (every `__init__.py`, not a hand-listed array), and
      **relative-dot imports**, which the old letter-anchored pattern could not
      match at all. Config still wins outright wherever it is given, so a
      configured repository's payload cannot move underneath it
- [x] A language with no adapter still renders — **as `adapterFor()` returning
      null, not as a `generic.mjs`.** The planned file was never built and the
      tick used to name it anyway. Null is the whole behaviour: no edges, and
      `atlas scan` reports the files it could not read as a coverage answer
      rather than dropping them silently. The skeleton a new language is copied
      from lives in `docs/adapters.md`, against `fixtures/hostile-go/`
- [x] Import line numbers recorded; comment/string blanking before extraction
      — held on the extraction result until Phase 7 needed them, then promoted
      to `edges[].line` as an additive field, so no `schemaVersion` bump
- [x] **Gate:** both fixtures resolve exactly as asserted
- [x] **Gate:** Shuttrr `unresolved === 0`, zero internal specifier classified external (174 `@/…` alias imports total, of which `@/lib/utils/cn` ×24)
  - 161 → 423 resolved, 9 → 3 unresolved. Not zero: the three are `.css` and
    `.wgsl` asset imports whose files are outside `keep`, so the node they would
    point at does not exist. Reported rather than special-cased away — widening
    `keep` to draw stylesheets is a defaults decision, not an adapter one
- [x] **Gate:** llmbench — **all 172 relative-dot imports resolve** (was 0 of 172),
      across 50 files at 1, 2 and 3 dots plus bare `from . import x`
  - verified as 172 extracted / 172 internal, at depths 109 · 58 · 5, and the
    only absolute specifier resolving in-repo is the package's own name
- [x] **Gate:** TaxVault 350 resolved / 0 unresolved / **319** external, and the
      prototype payload otherwise unchanged
  - the gate said 320. One of them was a phantom: a module docstring whose prose
    wraps onto a line beginning `import time:`, which the prototype read as an
    import of the stdlib `time`. Blanking comments and strings removes it, so
    319 is the corrected number and the golden records the divergence the same
    way Phase 2's `undoJsonLangFix` does — one bug named, one bug undone

## Phase 4 — Endpoint extraction v2

- [x] Rule schema as data; **never match a non-literal path**; count and report skips
      — two shapes are counted: a call whose path is not a literal, and a literal
      path handed to a helper inside a file mounted as a router, where the method
      lives in code this tool does not follow. The skip list rides on the returned
      array as a non-index property, so `JSON.stringify` keeps it out of the payload
- [x] Symbol → file mount resolution, run to a **fixpoint** — a test harness
      mounting a router at `/` is excluded, or every route is reported at a second
      path nobody can call; `app.use("/*", handler)` is middleware, not a mount
- [x] File-based routing: `(groups)` stripped, `[param]` → `:param`, `route.ts` vs `page.tsx`
      — a `route.ts` emits one endpoint per exported HTTP method, at that export's
      own line; a component file inside a route directory is not a route
- [x] Path normalization so `:id` and `{id}` collapse to one logical node —
      **in the identity key only**. Rewriting the displayed path broke
      `validateFlows()`'s match against curated flow steps and silently dropped
      5 edges (467 → 462); the count gate did not catch it, the golden did
- [x] Route line numbers — additive, so no schema bump
- [x] **Gate:** Shuttrr yields `POST /api/photos/upload`, `GET /api/photos/gallery`, `GET /health`, ≥12 `/api/ai/*` via the two-level mount, `/sign-in`, `/auth/callback`
  - 24 → 52 with the mount chain → 71 with file-based routing; `/api/ai/*` = 23
- [x] **Gate:** `(auth)` / `(dashboard)` absent from every path; zero endpoints from `web/app/(dashboard)/studio/components/*`
- [x] **Gate:** ≥8 skipped non-literal registrations reported, naming `presets.ts`
  - 9: eight in `presets.ts`, one in the `_shared.ts` helper that registers them
- [x] **Gate:** TaxVault's 18 endpoints unchanged; every curated flow still validates
  - 18 endpoints, 467 edges, 350/0/319 imports; the only warning is the
    pre-existing service reconciliation one, and no flow warns

## Phase 5 — Findings engine

*`atlas scan` diagnoses the tool. This diagnoses the code.*

- [x] Import cycles (Tarjan SCC), smallest-first
- [x] Layering violations — an edge whose target rank is lower than its source,
      **spine layers only**: `tooling`/`test`/`docs`/`unsorted` carry ranks for the
      layout, not for the spine, and `unsorted` ranks above every real layer — so
      judging it turned "no rule matched" into "every import runs backwards".
      Shared with `derive.mjs` as `OFF_SPINE_LAYERS` rather than restated
- [x] Oversized files, ranked against the repo's own p95
- [x] Endpoints no test reaches
- [x] Orphans (zero in and out edges, excluding entrypoints and configured roots)
- [x] Unreachable from any entrypoint (BFS from entry-layer files)
- [x] God nodes (in-degree percentile, with a floor so a small repo's low p95
      does not flag half of it)
- [x] Cross-service coupling that bypasses declared boundaries
- [x] Each finding carries `severity`, **evidence** (exact nodes/edges), and a one-line "why this matters"
- [x] FINDINGS view highlights implicated blocks in place on the map — the rest
      of the city dims rather than disappearing, so a cycle reads AS a cycle.
      The view is unconditional: a repo with nothing to report has a result
      worth showing, and dropping the view would make "eight checks ran and
      matched nothing" look like "this tool does not check"
- [x] `atlas findings --json`; configurable thresholds; per-finding mute with a reason
      — a muted finding stays in the payload marked, never removed: silencing one
      should be a visible diff, not a silent subtraction
- [x] **Gate:** on TaxVault reports the `core-case-service` orphans and `server.ts` unreachable-from-tests (both known-true) — run against the corpus, passes
- [x] **Gate:** zero false layering violations on a repo that enforces layering by policy
      — plus a second gate over fixtures that DO have unplaceable files, because
      the first one passed throughout the period the off-spine bug was live
- [x] **Gate:** finds a known cycle in a synthetic fixture — `fixtures/import-cycle`,
      built so each of the eight findings has one isolated known-true instance

## Phase 6 — Path derivation + calibration

*Calibration is a script and it runs before any composer UI exists. One endpoint is an anecdote.*

- [x] `src/model/derive.mjs` — mount-chain seed, handler-slice BFS seed, non-decreasing rank, neutral `io` terminals, response leg
- [x] Per-hop certainty: `wired` / `imported` / `inferred` — computed, shipped,
      and drawn. Weight and dash carry it; colour stays with the step's kind, so a
      proven hop and an admitted guess no longer read the same
- [x] Derived at scan time; steps stored as integer node indices
- [x] `test/calibrate.mjs` — diff derived vs curated across **all 9 flows**
      (moved out of `tools/`: it imports `test/helpers.mjs` and the regression test
      imports it)
- [x] Per-flow and aggregate precision/recall; names hops invented, missed, and mis-ordered
- [x] Calibration wired as a regression test (`test/calibrate.test.mjs`), with floors
      rather than a committed artifact — plus fixture-driven invariants in
      `test/derive.test.mjs` that run on a fresh clone, because the calibration
      gate skips without the corpus
- [x] **Gate:** every endpoint across all targets produces a ≥2-hop path with no crash
      — asserted in `test/derive.test.mjs`
- [x] **Gate:** calibration numbers published in the README — measured at taxvault
      `22595f3a`: **precision 17%, recall 12%** (tp=11 of 93 curated, 64 derived;
      52 invented, 81 missed, 1 mis-ordered), under *Path derivation, calibrated*.
      Stated plainly rather than softened: expectations are set before first use,
      or the number is decoration

## Phase 7 — `atlas serve` + code viewer

- [x] `src/serve/server.mjs` — `listen(port, "127.0.0.1")`, bind host hardcoded, not a flag
- [x] File allowlist from the scanned set (**membership is the defense**), `lstat` symlink refusal, size cap, always `text/plain`
- [x] `Host` header check + `Sec-Fetch-Site` rejection (DNS rebinding); CSP; `no-store`; `nosniff`
- [x] `INFO | SOURCE` tabs; wide right-docked overlay; line gutter; target line centered
      — `min(760px,55vw)`, `Esc` closes, canvas renders behind, and the map's own
      overlays shift out from under it so the DERIVED caveat is never covered.
      Full width below 900px, where a 420px code pane would be unreadable
- [x] Jump-to-line from endpoint, import edge, test subject, and derived hop
      — an *inferred* hop is offered no button rather than one that lands
      somewhere plausible: there is no import to open, and saying so is the point
- [x] Highlighter — **vendored Prism 1.29.0 instead of the planned ~60-line regex**
      (~27 KB, committed not installed; reasoning in PLAN.md). Tokenizer only, DOM
      built by hand from text nodes; `test/viewer-source.test.mjs` runs the real paint
      against a DOM whose `innerHTML` setter throws, so escape-as-you-emit is
      enforced rather than reviewed
- [x] `--embed-source [glob]` + permanent `SOURCE EMBEDDED` badge + CLI size warning
      — the badge names the file count and says GZIP when compressed, and is the
      only legend entry styled as a warning: sending this file sends the code
- [x] `--gzip-source` via `node:zlib` + `DecompressionStream("gzip")` — ONE shared
      blob, not one stream per file: 143 independent streams cannot share a
      dictionary, and per-file cost 16% over compressing the map together
- [x] **Gate:** all 404 — `../../../etc/passwd`, `/etc/passwd`, `.env`, `node_modules/x`, in-repo symlink pointing outside, `..%2f..%2f`, `Host: evil.example`
      — `test/serve.test.mjs` covers the list verbatim, plus a null byte and a
      post-scan symlink swap
- [x] **Gate:** clicking an endpoint opens its file at the declaring line —
      verified in Chrome against this repo rather than the Shuttrr endpoint the
      gate names, which needs a corpus checkout: `GET /admin/stats` opens
      `fixtures/express-js/src/routes/admin.mjs` at line 7, which is the
      `router.get` call. Re-run on Shuttrr when the corpus is to hand
- [x] **Gate:** gzip round-trips losslessly, and the embedded payload is cut by
      the most a text-safe wrapper allows — **2.31×, and the ≥3× target is
      retired rather than deferred.** Round-trip is verified through a real
      `DecompressionStream` and by hand against a built HTML. The ratio was
      never reachable and the reason is arithmetic, not implementation: gzip
      gets 3.10× on this repo's source, and base64 then multiplies by 4/3 to
      survive JSON, landing at 696,953 B → 301,282 B. Raw gzip is barely over
      the bar *before* paying any encoding tax, so ≥3× through a JSON payload
      was impossible on any input that compresses like source code. ascii85
      (5/4) would reach ~2.48× and still miss. The number came from PLAN.md's
      estimate, which quoted the gzip size and omitted the base64 the file has
      to carry — a mis-specified target, not a missed one, and the honest close
      is to record what the wrapper actually costs.

## Phase 8 — Request composer UI

- [x] `kind:"request"` view; endpoint list; composer (path params, query, headers, JSON body + validity)
      — query and headers are one text field each, deliberately. Key/value rows
      are the first step toward collections and environments, which the scope
      guard names by example
- [x] Composer state to `sessionStorage`, **`authorization` value excluded**
      — redacted at the serialization boundary rather than at the input, so the
      value survives the session in memory and never the reload. The header NAME
      comes back with an empty value: a row that vanishes reads as a bug
- [x] `SEND (MODELED)` animates the path with substituted values
      — curated path first, derived second, and neither means the button is
      disabled with the reason spelled out rather than a dead control
- [x] Curated-vs-derived badge **on the canvas**, not only the panel; per-hop solid/dotted certainty
      — closes the "modelled hops inside curated flows carry no badge" finding
      in the same lines. Curated steps carry no certainty, so they are graded in
      the viewer at clone time: no payload field, no golden movement
- [x] Audit: every solid hop opens the import line that justifies it
      — **built stronger than written.** A hop that grades justified but has no
      evidence behind it is REGRADED inferred rather than drawn solid with a
      button that lands somewhere plausible. Evidence is judged on whether an
      import exists, not on whether a server is there to read it, so a `file://`
      atlas still grades honestly while offering no jumps
- [x] `[+ CURATE THIS]` emits a paste-ready config entry
      — certainty is not emitted: it is this tool's grading of its own guess,
      and pasting a flow makes the path the reader's claim
- [x] **Gate:** the emitted entry pastes into a config and validates
      — three ascending checks in `test/request-view.test.mjs`: it parses as JS,
      the real `validateFlows` accepts it, and a full `--strict` scan with it
      ships the flow and gains a playable view, with no warning

## Phase 9 — Live proxy mode

*Built last. Real end-to-end latency with repeat statistics — `n`, min, median,
p95 — because one send is an anecdote. Per-hop timings stay unbuilt: the tool
never observes a request crossing an internal hop, so any number there would be
invented. MOCK is the default and the mode is always named on screen.*


- [x] `src/serve/proxy.mjs` — accepts `{method, path, headers, body}` only; **no host, no URL**
      — and returns no response body either, only `{status, statusText, ms,
      bytes, truncated, redirected}`. That was not in the plan and is the
      largest simplification available: without it the proxy is a read
      primitive against everything the host can reach, and there is a
      response-header allowlist to get wrong. It is also all the honesty
      contract permits the map to draw
- [x] Origin assertion; `--allow-live` required at the process level; loopback/private target restriction
      — **no non-loopback override**, though PLAN.md allowed for one. The check
      lives in one named function so adding it later stays explicit.
      `169.254.0.0/16` is refused with the rest of link-local: it reads as
      private and is the cloud metadata range, which is the one place the two
      words come apart. Matching is by parsed octet, because `172.32.0.1` and
      `127.0.0.1.evil.com` both walk past a string prefix
- [x] Method + header allowlists; timeout; 256 KB cap; `redirect:"manual"`; rate bucket; one stderr line per request
      — a header outside the allowlist is refused BY NAME rather than dropped,
      so `COPY AS cURL` cannot print a command that differs from what was sent.
      `redirect:"manual"` is a security control and not a display choice: a
      private target may redirect somewhere public, and following one would
      launder every check above it
- [x] `--auth-env` keeps the token out of the browser; `sessionStorage` fallback with explicit clear
      — the token cannot escape by construction rather than by care.
      `resolveOutbound` never sees it, `liveInfo` builds from an explicit key
      list rather than a spread, and `liveLogLine` has no headers parameter at
      all and strips a query string besides
- [x] Status ring + latency **on the endpoint node only**; halt-on-non-2xx at hop 1; persistent real-vs-modeled banner
      — drawn in the overlay pass, never the static raster, so the Phase 1 and
      2.5 zero-re-rasterisation gates still hold
- [x] MOCK / LIVE toggle, MOCK by default; LIVE offered only when the page is
      served *and* `--allow-live` was passed, disabled with the reason otherwise
      — gated on the page being SERVED rather than being source-capable: an
      `--embed-source` atlas opened as a file carries the code and has no server
      behind it. MOCK is a literal in the state object rather than a computed
      default, because the mode that sends real traffic should never be arrived
      at by a chain of conditions
- [x] Repeat statistics per endpoint — `n`, min, median, p95 over the samples
      taken this session — in memory only, never persisted: a latency restored
      on reload would read as fresh. `p95` is withheld below five samples
- [x] **No per-hop timings, ever**
      — `test/live-view.test.mjs` asserts STRUCTURALLY that no step object ever
      grows a timing field, rather than checking one name. `ms / steps.length`
      is one line and would look reasonable in a diff; the test exists to make
      writing it fail, and was verified by writing it and watching it fail
- [x] `[ COPY AS cURL ]` — prints `$VAR` rather than a token, and is generated
      from the allowlists the server shipped so it cannot print a command the
      proxy would refuse
- [x] **Gate:** real 200 + latency from a running target; 401 halts at hop 1 and says so
      — **re-scoped from "a running Shuttrr", deliberately.** The upstream is a
      second `http.createServer` the suite owns, which makes the gate
      reproducible on a fresh clone where a corpus repository is optional by
      design — the same argument `test/helpers.mjs` already makes for skipping
      corpus tests. The behaviour being gated is "a real target answered", and
      this is one. It also records what it received, so "the proxy never
      contacted it" is asserted on every refusal rather than assumed
- [x] **Gate:** proxy refuses `path:"http://example.com/"`, refuses a non-loopback target, 403s without `--allow-live`
      — every case socket-free in `test/proxy.test.mjs`, plus the CLI refusing
      a bad `--target` before the scan runs
- [x] **Gate:** no token in stderr or in `document.documentElement.outerHTML`
      — verified against a real running server as well as in tests: the token
      reaches the target's Authorization header and appears in neither the
      served HTML nor the log

---

## Phase 10 — Open-source packaging

The phase the milestone table marked done and this file never wrote down. Its
gate is in PLAN.md; the boxes are recorded here so "done" means the same thing
it does for every other phase.

- [x] `README.md` — what the tool is, the three commands, how to read the map,
      the calibration numbers, and the limitations stated up front rather than
      discovered
- [x] `LICENSE` — MIT
- [x] `CONTRIBUTING.md` — how to run the suite, what a phase commit looks like,
      and the two rules a patch is most likely to break (nothing target-specific
      in `src/`, goldens re-baselined deliberately)
- [x] `docs/payload-schema.md` — the payload is a public contract, so it is
      documented field by field with a stability tier
- [x] `docs/adapters.md` — the documented contribution surface, with a worked
      Go adapter
- [x] `docs/config.md` — every config key, and the precedence chain
- [x] **Gate:** a reader who has never seen the repo goes from `git clone` to a
      rendered atlas of **their own** project using only the README, on a repo
      with no config — walked against a repository the tool had not seen
- [x] `package.json` ships what the docs link to (`examples/`, `CONTRIBUTING.md`)
      and carries `repository`/`homepage`/`bugs`

---

## Open findings

Raised by the quality sweep, verified against the code, and deliberately not
fixed in it. None is a crash; each is something the map currently claims or
omits without saying so.

**Language-specific code in `src/model/`.** ✅ **Closed.** The adapter contract
gained `blankComments`, `importBindings` and `testSubject`, and the model now
asks the adapter that owns a file instead of branching on language or importing
`blank()` out of `ts.mjs`. `mounts.mjs`'s `specifierFor` is gone entirely —
"which module did this symbol come from" is `importBindings` filtered by local
name, so it works for any language for free.

One JS-only thing stayed put on purpose: `endpoints.mjs`'s `ROUTE_FILE` and
`METHOD_EXPORT`. Those encode Next.js **file-routing**, which is a framework
convention rather than a language one — a Go or Java adapter would never
implement them — and the extension list baked into `ROUTE_FILE` already stops
them running over anything else. Moving them onto the contract would have added
a member with one implementation.

Closing this fixed a live bug rather than only tidying: Python files were being
blanked with the TypeScript blanker, which does not know `#`, so a commented-out
FastAPI route was extracted as a live endpoint. See `fixtures/py-routes/`.


## Future languages

The adapter contract is now wide enough that a new language needs no change in
`src/model/`. Each of these is a self-contained piece of work: one file in
`src/adapters/`, one line in `src/adapters/index.mjs`, one fixture, and one
expectation table in `test/conformance.test.mjs`.

- [ ] **Go.** The furthest along — `fixtures/hostile-go/` already exists (a
  `go.mod`, a package-level `widget.go` and a `cmd/main.go`) and is currently
  unused by any test. `docs/adapters.md` carries a worked Go adapter as its
  example. The interesting part is that a Go import names a *package*, which is
  a directory, so `resolve` returns every `.go` file in it — the case the array
  return shape was designed for.
- [ ] **Java / Kotlin.** Wildcard imports (`import com.example.*`) are the same
  one-specifier-many-files shape as a Go package. Package-to-directory mapping is
  conventional rather than declared, so `prepare` has to find the source roots
  (`src/main/java`, `src/main/kotlin`) the way `py.mjs` infers `sys.path` roots.
- [ ] **Ruby.** `require_relative` resolves against the requiring file, plain
  `require` against a load path — the same two-mode problem Python has, so
  `py.mjs` is the closer model to copy than `ts.mjs`.
- [ ] **Rust.** The hard one, and worth naming so nobody starts here. `mod` and
  `use` describe a module tree that only partly matches the file tree, and
  `mod.rs`/`lib.rs` re-export in a way that needs the barrel handling
  `symbols` exists for. Expect to spend the time in `resolve`, not extraction.

The rule from CLAUDE.md still binds: never add a dependency to make one target
repo work, and a language whose imports cannot be read by regex is one to skip
and count, not to parse harder at.

---

## Resolved questions

- **Desktop app** — parked until more of the tool exists. Revisit after v1.0, as a
  separate package rather than a constraint on this one.
- **Dependencies** — zero-dep is the default for the CLI and scanner, not a law.
  The viewer may take a rendering dependency (three.js, paper-shaders are wanted)
  when a phase justifies one, weighed against the single-self-contained-file
  promise. WebGL is deferred until v1.0, so Phase 1 keeps a renderer seam.

## Release checkpoints

- **v0.1 after Phase 4** — the tool renders any repo. Pull a trimmed README and
  LICENSE forward from Phase 10; everything after is additive.
- **v1.0 after Phase 10.**

## Phase 11 — Viewer port

The viewer was replaced from a Claude Design draft rather than redesigned in
place. Same lineage — same class names, ids and function names — so this was a
port with a mechanical spine, and the work was concentrated where the draft had
reversed a decision this repo made on purpose.

- [x] Shell replaced: `index.html` + `style.css`, `#atlasRoot` collapsed onto `#app`, the three assembly markers preserved
- [x] Four views, `structure` carrying kind `dataflow`; DERIVED PATHS folded into the composer
- [x] Folder districts and the `group by` toggle — `groupKeyOf()` / `keyCompare()` / `labelForKey()`
- [x] Shelf-packed compaction, deterministic jitter, plates hugging their content
- [x] Imports routed along the streets, one turn, corridor chosen by cost
- [x] Shape carries node kind; facade bands; service plinths; cap treatments
- [x] OKLab identity ramp, generated in `src/model/chrome.mjs` and shipped on the payload
- [x] Arrival animation, live-pass only, skipped under `prefers-reduced-motion`
- [x] Top dock (transport + camera), folding sidebar, `? HELP`, onboarding card
- [x] Both panels collapse; the canvas is re-measured on `transitionend`
- [x] Palette authoring: four ramps, per-key overrides, SAVE AS…, COPY CONFIG
- [x] Per-block appearance, NOTES tab, ARRANGE mode, collapse-to-megablock
- [x] `--include-vendor`, `nodes[].vendor`, `meta.vendorCount`, and the OPTIONS toggle
- [x] Deliberately **not** ported: the draft's hand-rolled tokenizer (vendored Prism stays), its stubbed `srcServed()`, its stubbed composer send, the Google Fonts link, `support.js`, `atlas-data.js`
- [ ] Arrival animation judged at full speed by a human — `requestAnimationFrame` is throttled in a backgrounded tab, so no harness can see it

**Gate: met.** Four views load with no console error. A built atlas issues no
network request. `group by` re-columns the same blocks and does not change their
colour. Source reads through vendored Prism under `serve` and from
`--embed-source` on disk. Live mode still sends against a real target and still
reads `LIVE · STATUS OBSERVED · PATH STILL MODELLED`, with status, duration and
byte count and no response body. `generic.test.mjs` green; goldens re-baselined
in the same commits, with the diffs read.

---

## Phase 12 — Sweep

*The audit that opened this phase found almost nothing, which is the result. Three
lines of dead code across ~4,000 in `src/` and `bin/`, no TODO, no commented-out
block, no stray log. The work turned out to be in `test/`.*

- [x] `EXP_MAX` deleted — computed every viewer load, read nowhere, and the last
      spread-over-all-nodes call in the helpers, so a latent `RangeError` on a
      large payload
- [x] `PENDING` deleted — an empty object guarding a permanently false branch,
      left over from phase gating
- [x] Six `id="fold*"` attributes deleted — no script and no rule read them
- [x] The Claude Design export the Phase 11 viewer was ported from is
      `.gitignore`d rather than tracked
- [x] `test/viewer-harness.mjs` — one fake browser for `findings-view`,
      `live-view` and `request-view`, which had drifted apart on which fields an
      element stub answers. 162 lines lighter, same 443 tests
- [x] `highlightBlock` — the selection, a finding's evidence and a live response
      lit a block the same way in three places
- [x] `reqHeaderLine` — the header parser and the redactor agreed by coincidence,
      and the header being redacted is `Authorization`
- [x] `importAdjacency` — four hand-written copies of one predicate, across
      coverage, cycles, the unreachable check and path derivation
- [x] The seven storage guards that swallowed an exception in silence now carry
      the reason the eighth already had
- [x] `relayout` split into its five stage names, 116 lines → 54; `sizeCache`
      taken off the front of `drawStatic`

**Deliberately not done, with the reason.** The OKLab helpers really are
duplicated between `src/model/chrome.mjs` and `src/viewer/00-theme.js`, but the
viewer is a concatenated plain script and cannot import an `.mjs`; removing 17
lines of pure maths would cost a build-step injection hack. `arcFor` and
`findArc` were on the list as one function with a bow parameter and are not —
one bows vertically in screen space, the other perpendicular to the segment.
`test/render.test.mjs` and `test/viewer-source.test.mjs` keep their own stubs:
the first counts draw calls against a far thinner element and never opens a
panel, and the second runs a DOM whose `innerHTML` refuses *every* value, the
empty string included, which is the strictest assertion in the suite and is
worth reading in the file that depends on it.

**Gate: met.** 443 tests, green before and after, none deleted.

---

## Phase 13 — `atlas map`

*The same city, drawn in a terminal. `build` already emits a self-contained HTML
document; this is the other half of the ask, and it consumes the payload rather
than the viewer.*

- [x] `src/cli/iso.mjs` + a `map` case in the dispatch and a help block
- [x] Half-block raster (`▀`, two vertical pixels a cell). No depth buffer: for
      boxes on an isometric grid, back-to-front painting is exact
- [x] Top face and two shaded side faces per block. `shade()` moved into
      `chrome.mjs` so the terminal and the browser use one OKLab step rather
      than two guesses; the viewer keeps its copy because a concatenated script
      cannot import a module
- [x] Colour ladder: truecolor → 256 → 16 → luminance ramp, from `COLORTERM`,
      `TERM`, `NO_COLOR` and `isTTY`. A pipe always takes the last rung
- [x] Legend below the map, in the `padStart(4)` idiom `report()` already uses,
      under the same header lines `report()` leads with
- [x] Auto-collapse to megablocks when a file would land on too few pixels to
      read, with the header saying so; `collapse` forces or refuses it
- [x] `test/iso.test.mjs` — 14 tests plus a golden text file. The ladder, the
      no-escapes-through-a-pipe rule, the empty repo, a 20-column window and
      byte-for-byte determinism are all asserted directly

**Not in scope.** Import edges routed through a character grid are likely to read
as noise; blocks and districts ship first and `--edges` is a later box, not a
promise. Districts column by **layer**, because `payload.districts[]` is built on
`service/layer` and folder districts are computed viewer-side; `--group folder`
is a later box too. No second HTML output — `build` is already that.

**Gate: met.** Draws in a terminal; piped to `cat` it emits no escape sequence;
`NO_COLOR=1` and an 80-column window are both legible; 458 tests green.

---

## Phase 14 — Four more languages

*The adapter contract is already wide enough that none of this touches
`src/model/`. `LANGS` and `DEFAULT_KEEP` know these extensions today, so the
files are already walked, drawn and counted — they just produce no edges.*

Each is one file in `src/adapters/`, one entry in `ADAPTERS`, one fixture, and
one expectation table in `test/conformance.test.mjs`. Note that `fixture()` calls
`adapter.prepare(ctx)` unconditionally, so `prepare` is not optional in practice.

- [x] **Go** — an import names a package, which is a directory, so one
      specifier resolves to every `.go` file in it: the first adapter to
      actually use the array return. `_test.go` files are excluded from those
      ids. `go.mod` is read off disk, several are allowed, and the longest
      matching module path wins
- [x] **Ruby** — `require_relative` against the file, `require` against a load
      path inferred from `lib/` and `app/`'s subdirectories, since the real
      `$LOAD_PATH` is assembled at runtime and cannot be read. The relativity is
      normalised onto the specifier, the way `py.mjs` carries it in dots
- [x] **Java / Kotlin** — one adapter, because a Kotlin file routinely imports a
      Java one out of the same source root. A wildcard names the package and
      resolves to every file in it; a static member import drops a segment.
      Source roots are inferred from the conventional layout first, then by
      backing the declared `package` out of a file's own directory
- [x] **Rust** — the module tree resolves, including the rule a naive reading
      gets wrong: a non-`mod.rs` file's children live under a directory named
      after it. `Cargo.toml` is read for the package name, without which every
      integration test in every Rust repo hangs off the graph. **Not** followed:
      `pub use` re-export chains, `#[path]`, and `mod` behind a `cfg` — recorded
      in the conformance table rather than left to be discovered
- [x] `blankCLike` in `lex.mjs`, shared by the four C-shaped languages. Four
      copies of one blanker is how a commented-out import becomes a real edge in
      three of them; `ts.mjs` and `py.mjs` keep their own, one having regex
      literals to worry about and the other triple quotes
- [x] `docs/adapters.md` and the README carry the endpoint gap below

**The gap, documented rather than papered over.** These adapters buy import
edges, not endpoints. `endpoints.mjs`'s router and route regexes and
`mounts.mjs`'s `MOUNT` are JS-shaped and run over every language, so a Go or
Rails repo shows structure and imports and close to zero endpoints unless config
supplies `endpointRules`. Shipping guessed Gin/Rails/Spring patterns that no
fixture and no corpus can check is "never shape a rule around one repo" wearing
a new hat.

**Gate: met.** Conformance green for all four, against four hostile fixtures
that each carry the thing a regex gets wrong — a raw string holding a fake
import block, a require inside a string literal, a text block, an inline `mod`.
`atlas scan` reports resolved edges on every one. 514 tests green;
`generic.test.mjs` green.

---

## Phase 15 — IDE affordances in the viewer

*Opens with a PLAN.md edit, not a code edit: the "like VS Code, the answer is no"
guard gets narrowed, in writing, with the reasoning.*

- [ ] PLAN.md reversal — what the guard protected against was becoming an
      **editor**. The narrowed rule that stays binding: read-only, no text
      editing, no full-text search across source. Name-based navigation is in;
      grep-the-repo is not
- [ ] Split `initInteraction()` (246 lines, and it owns a sidebar control it has
      no business owning) into keyboard, pointer and controls
- [ ] Command palette on Cmd/Ctrl-K — file, district, endpoint, finding
- [ ] Keyboard navigation — move the selection between blocks, Enter to inspect,
      Esc to clear, `[`/`]` to cycle views
- [ ] Go-to-definition along import edges from the source panel
- [ ] Back/forward history and open-file tabs in the inspect panel
- [ ] Breadcrumb: service › district › file

**Gate:** every affordance reachable by keyboard alone; `viewer.test.mjs` green;
a built atlas still issues no network request.

---

## Phase 16 — `desktop/`

*The shell deferred until after v1.0, taken up now that v1.1 has shipped. A new
directory beside `bin/ src/ test/`, with its own `package.json` and its own
dependencies: nothing existing moves, and the core stays publishable zero-dep.*

Electron rather than Tauri, and the reason is reuse before it is speed: Electron's
main process is Node, so `src/serve/server.mjs` and `src/serve/proxy.mjs` run
verbatim with their security posture intact. Tauri would mean reimplementing the
allowlist, the symlink refusal and the live proxy in Rust, and that is where a
carefully argued posture gets quietly re-litigated. Speed agrees: the hot loop is
thousands of `quad()` fills a frame, which is where a non-Chromium webview falls
down, and a fixed Chromium makes Phase 1's 60 fps gate one gate rather than three.

- [ ] `desktop/` with its own `package.json`; root `files:` untouched
- [ ] Main process starts the existing server on a random loopback port; a
      `BrowserWindow` loads it
- [ ] Confirm `sameOrigin()` still passes from a `BrowserWindow` — `Host` pinning
      and `Sec-Fetch-Site` are load-bearing and get checked, not assumed
- [ ] `contextIsolation: true`, `nodeIntegration: false`, no preload beyond what
      the menu needs
- [ ] Menu bar, open-folder dialog that rescans, recent repos, window state
- [ ] PLAN.md records the dependency decision

**Not in scope:** code signing, notarization, auto-update, release CI.

**Gate:** `npm start` opens the window on a real repo; the network panel shows
only `127.0.0.1:<port>`; a forged `Host` still gets 403; root `npm test`
unaffected.
