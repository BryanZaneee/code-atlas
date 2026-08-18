# code-atlas — roadmap

Progress tracker for [PLAN.md](./PLAN.md). A phase is done when **every** box under it is checked — the gate is the definition of done, not a suggestion.

**Status:** Phases 0, 2, 2.5 and 3 complete; Phase 1 holds one gate a human has to
measure. Phase 4 (endpoint extraction) is next · 4 of 12 phases complete

| # | Milestone | Unblocks | Status |
| --- | --- | --- | --- |
| 0 | Repo skeleton, lift-and-shift, payload contract | everything | ● done |
| 1 | Renderer: perf, rotation, decoupling | 7, 8, 9 | ◐ one gate open |
| 2 | Config, detection, graceful degradation | 3, 4 | ● done |
| 2.5 | Visual system: palette, selection, chrome | — | ● done |
| 3 | Language adapters + conformance fixtures | 4, 6 | ● done |
| 4 | Endpoint extraction v2 | 5, 6, 8 | ○ |
| 5 | Findings engine | — | ○ |
| 6 | Path derivation + calibration | 8 | ○ |
| 7 | `atlas serve` + code viewer | 8, 9 | ○ |
| 8 | Request composer UI | 9 | ○ |
| 9 | Live proxy mode | — | ○ |
| 10 | Open-source packaging | — | ○ |

Legend: ○ not started · ◐ in progress · ● done

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
- [x] `meta.schemaVersion = 1`
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
- [x] `src/adapters/generic.mjs` — no edges, still renders; now also the
      documented skeleton a new language is copied from
- [x] Import line numbers recorded; comment/string blanking before extraction
      — carried on the extraction result only. Nothing consumes them until
      Phase 7, and the payload is a versioned public contract
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

- [ ] Rule schema as data; **never match a non-literal path**; count and report skips
- [ ] Symbol → file mount resolution, run to a **fixpoint** (Shuttrr's mounts are two levels deep)
- [ ] File-based routing: `(groups)` stripped, `[param]` → `:param`, `route.ts` vs `page.tsx`
- [ ] Path normalization so `:id` and `{id}` collapse to one logical node
- [ ] Route line numbers
- [ ] **Gate:** Shuttrr yields `POST /api/photos/upload`, `GET /api/photos/gallery`, `GET /health`, ≥12 `/api/ai/*` via the two-level mount, `/sign-in`, `/auth/callback`
- [ ] **Gate:** `(auth)` / `(dashboard)` absent from every path; zero endpoints from `web/app/(dashboard)/studio/components/*`
- [ ] **Gate:** ≥8 skipped non-literal registrations reported, naming `presets.ts`
- [ ] **Gate:** TaxVault's 18 endpoints unchanged; every curated flow still validates

## Phase 5 — Findings engine

*`atlas scan` diagnoses the tool. This diagnoses the code.*

- [ ] Import cycles (Tarjan SCC), smallest-first
- [ ] Layering violations — an edge whose target rank is lower than its source
- [ ] Oversized files, ranked against the repo's own p95
- [ ] Endpoints no test reaches
- [ ] Orphans (zero in and out edges, excluding entrypoints)
- [ ] Unreachable from any entrypoint (reverse BFS)
- [ ] God nodes (in-degree percentile)
- [ ] Cross-service coupling that bypasses declared boundaries
- [ ] Each finding carries `severity`, **evidence** (exact nodes/edges), and a one-line "why this matters"
- [ ] FINDINGS view highlights implicated blocks in place on the map
- [ ] `atlas findings --json`; configurable thresholds; per-finding mute with a reason
- [ ] **Gate:** on TaxVault reports the `core-case-service` orphans and `server.ts` unreachable-from-tests (both known-true)
- [ ] **Gate:** zero false layering violations on a repo that enforces layering by policy
- [ ] **Gate:** finds a known cycle in a synthetic fixture

## Phase 6 — Path derivation + calibration

*Calibration is a script and it runs before any composer UI exists. One endpoint is an anecdote.*

- [ ] `src/model/derive.mjs` — mount-chain seed, handler-slice BFS seed, non-decreasing rank, neutral `io` terminals, response leg
- [ ] Per-hop certainty: `wired` / `imported` / `inferred`
- [ ] Derived at scan time; steps stored as integer node indices
- [ ] `tools/calibrate.mjs` — diff derived vs curated across **all 9 flows**
- [ ] Per-flow and aggregate precision/recall; names hops invented, missed, and mis-ordered
- [ ] Calibration output committed and wired as a regression test
- [ ] **Gate:** every endpoint across all targets produces a ≥2-hop path with no crash
- [ ] **Gate:** calibration numbers published in the README

## Phase 7 — `atlas serve` + code viewer

- [ ] `src/serve/server.mjs` — `listen(port, "127.0.0.1")`, bind host hardcoded, not a flag
- [ ] File allowlist from the scanned set (**membership is the defense**), `lstat` symlink refusal, size cap, always `text/plain`
- [ ] `Host` header check + `Sec-Fetch-Site` rejection (DNS rebinding); CSP; `no-store`; `nosniff`
- [ ] `INFO | SOURCE` tabs; wide right-docked overlay; line gutter; target line centered
- [ ] Jump-to-line from endpoint, import edge, test subject, and derived hop
- [ ] ~60-line regex highlighter (ts/js/tsx, py, sql, json); escape-as-you-emit, never `innerHTML` on source
- [ ] `--embed-source [glob]` + permanent `SOURCE EMBEDDED` badge + CLI size warning
- [ ] `--gzip-source` via `node:zlib` + `DecompressionStream("gzip")`
- [ ] **Gate:** all 404 — `../../../etc/passwd`, `/etc/passwd`, `.env`, `node_modules/x`, in-repo symlink pointing outside, `..%2f..%2f`, `Host: evil.example`
- [ ] **Gate:** clicking `POST /api/photos/upload` opens `photos.ts` at line 12
- [ ] **Gate:** gzip round-trips; embedded size cut ≥3×

## Phase 8 — Request composer UI

- [ ] `kind:"request"` view; endpoint list; composer (path params, query, headers, JSON body + validity)
- [ ] Composer state to `sessionStorage`, **`authorization` value excluded**
- [ ] `SEND (MODELED)` animates the path with substituted values
- [ ] Curated-vs-derived badge **on the canvas**, not only the panel; per-hop solid/dotted certainty
- [ ] Audit: every solid hop opens the import line that justifies it
- [ ] `[+ CURATE THIS]` emits a paste-ready config entry
- [ ] **Gate:** the emitted entry pastes into a config and validates

## Phase 9 — Live proxy mode

- [ ] `src/serve/proxy.mjs` — accepts `{method, path, headers, body}` only; **no host, no URL**
- [ ] Origin assertion; `--allow-live` required at the process level; loopback/private target restriction
- [ ] Method + header allowlists; timeout; 256 KB cap; `redirect:"manual"`; rate bucket; one stderr line per request
- [ ] `--auth-env` keeps the token out of the browser; `sessionStorage` fallback with explicit clear
- [ ] Status ring + latency **on the endpoint node only**; halt-on-non-2xx at hop 1; persistent real-vs-modeled banner
- [ ] **No per-hop timings, ever**
- [ ] `[ COPY AS cURL ]`
- [ ] **Gate:** real 200 + latency from a running Shuttrr; 401 halts at hop 1 and says so
- [ ] **Gate:** proxy refuses `path:"http://example.com/"`, refuses a non-loopback target, 403s without `--allow-live`
- [ ] **Gate:** no token in stderr or in `document.documentElement.outerHTML`

## Phase 10 — Open-source packaging

- [ ] `README.md` — why it exists · **real-vs-modeled table placed before the feature list** · quick start with no config · running the servers + security posture · configuration with two worked examples · features · tech stack **and why** · limitations incl. the Phase 6 calibration numbers
- [ ] `LICENSE`, `CONTRIBUTING.md`
- [ ] `docs/payload-schema.md` — every field, with a stability tier
- [ ] `docs/adapters.md` — "add a language in 30 lines", against a real fixture
- [ ] `docs/config.md`
- [ ] **Gate:** a reader who has never seen the repo goes from `git clone` to a rendered atlas of their own project using only the README, on a repo with no config

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
