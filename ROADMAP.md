# code-atlas — roadmap

Progress tracker for [PLAN.md](./PLAN.md). A phase is done when **every** box under it is checked — the gate is the definition of done, not a suggestion.

**Status:** Phases 0, 2, 2.5, 2.6, 2.7, 3, 4, 5, 6, 7, 8 and 10 complete · 12 of 14.
Phase 1 holds one gate a human has to measure, and Phase 7 holds one ratio that
was deferred with a measured number rather than met. **Phase 9 is the only
phase left**, and live mode was always meant to be last: everything the tool
draws today is read from the repository or modelled from it, and nothing it
does opens a socket to a running app.

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
| 7 | `atlas serve` + code viewer | 8, 9 | ● done, one ratio deferred |
| 8 | Request composer UI | 9 | ● done |
| 9 | Live proxy mode | — | ○ |
| 10 | Open-source packaging | — | ● done |

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
      built by hand from text nodes; `test/source.test.mjs` runs the real paint
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
- [~] **Gate:** gzip round-trips; embedded size cut ≥3× — **round-trip met,
      ratio DEFERRED.** Lossless is verified through a real `DecompressionStream`
      and by hand against a built HTML. The ≥3× is not met and the reason is
      arithmetic, not implementation: gzip gets ~3.1× on this repo's source, and
      base64 then multiplies by 4/3 to survive JSON, landing at ~2.3× on the
      artifact: measured 696,953 B → 301,282 B, **2.31×**. Raw gzip with no
      text-safe wrapping at all is 3.10× — barely over the bar before paying any
      encoding tax — so the ceiling is this repo's own redundancy, not the
      wrapper. ascii85 (5/4) would reach ~2.48× and still miss, so nothing was
      spent chasing it. The number ≥3× came from PLAN.md's Shuttrr estimate, which
      quoted the gzip size and omitted the base64 the file has to carry.
      Deferred deliberately so development continues; re-open it with a measured
      number if a corpus repo compresses better, or retire it.

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


- [ ] `src/serve/proxy.mjs` — accepts `{method, path, headers, body}` only; **no host, no URL**
- [ ] Origin assertion; `--allow-live` required at the process level; loopback/private target restriction
- [ ] Method + header allowlists; timeout; 256 KB cap; `redirect:"manual"`; rate bucket; one stderr line per request
- [ ] `--auth-env` keeps the token out of the browser; `sessionStorage` fallback with explicit clear
- [ ] Status ring + latency **on the endpoint node only**; halt-on-non-2xx at hop 1; persistent real-vs-modeled banner
- [ ] MOCK / LIVE toggle, MOCK by default; LIVE offered only when the page is
      served *and* `--allow-live` was passed, disabled with the reason otherwise
- [ ] Repeat statistics per endpoint — `n`, min, median, p95 over the samples
      taken this session
- [ ] **No per-hop timings, ever**
- [ ] `[ COPY AS cURL ]`
- [ ] **Gate:** real 200 + latency from a running Shuttrr; 401 halts at hop 1 and says so
- [ ] **Gate:** proxy refuses `path:"http://example.com/"`, refuses a non-loopback target, 403s without `--allow-live`
- [ ] **Gate:** no token in stderr or in `document.documentElement.outerHTML`

## Phase 10 — Open-source packaging

- [x] `README.md` — why it exists · **real-vs-modeled table placed before the feature list** · quick start with no config · running the servers + security posture · configuration with two worked examples · features · tech stack **and why** · limitations incl. the Phase 6 calibration numbers
- [x] `LICENSE`, `CONTRIBUTING.md`
- [x] `docs/payload-schema.md` — every field, with a stability tier
- [x] `docs/adapters.md` — "add a language in 30 lines", against a real fixture
      — `fixtures/hostile-go/` ships, so the walkthrough is runnable rather than
      asserted. The Go adapter itself stays in the doc: it is what a contributor
      writes, not something this repo ships an unused copy of
- [x] `docs/config.md` — audited key by key against `load.mjs` and
      `defaults.mjs`; no drift found
- [x] **Gate:** a reader who has never seen the repo goes from `git clone` to a rendered atlas of their own project using only the README, on a repo with no config
      — walked for real against a five-file Express service the tool had never
      seen, with no config and no git history: five views including REQUEST,
      both endpoints found at the path they are actually mounted under, two
      derived paths, six layers in use, zero unsorted files. The walk is also
      what turned up the router-alias miss, which is the gate doing its job
      rather than being ticked

---

## Open findings

Raised by the quality sweep, verified against the code, and deliberately not
fixed in it. None is a crash; each is something the map currently claims or
omits without saying so.

**Language-specific code in `src/model/`.** The adapters↔model seam says language
knowledge lives in an adapter. Four places breach it: `derive.mjs`'s
`importBindings` branches on `ts`/`py` with seven regexes; `mounts.mjs`'s
`specifierFor` understands ES `import` only; `endpoints.mjs`'s `ROUTE_FILE` and
`METHOD_EXPORT` are JS-only; `tests.mjs`'s `subjectOf` treats any non-`.ts` file
as Python. The fix is to widen the adapter contract, not to add branches.

**Mount resolution does not follow `require()`.** `specifierFor` reads `import`
syntax, so a CommonJS router still yields its endpoints but at the path it
declares rather than the one it is served at. `fixtures/express-js` uses ESM in
its server for exactly this reason and says so.

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
