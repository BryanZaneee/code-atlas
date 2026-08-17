# code-atlas — roadmap

Progress tracker for [PLAN.md](./PLAN.md). A phase is done when **every** box under it is checked — the gate is the definition of done, not a suggestion.

**Status:** Phase 0 in progress · 0 of 11 phases complete

| # | Milestone | Unblocks | Status |
| --- | --- | --- | --- |
| 0 | Repo skeleton, lift-and-shift, payload contract | everything | ◐ in progress |
| 1 | Renderer: perf, rotation, decoupling | 7, 8, 9 | ○ |
| 2 | Config, detection, graceful degradation | 3, 4 | ○ |
| 3 | Language adapters + conformance fixtures | 4, 6 | ○ |
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
- [ ] `package.json` — `bin:{atlas}`, `engines>=20`, **no `dependencies` field**
- [ ] `bin/atlas.mjs` — `parseArgs` subcommand dispatch (`build`/`serve`/`init`/`scan`/`findings`)
- [ ] Scanner split into `src/scan/*` + `src/model/*`
- [ ] Viewer split into `src/viewer/*` + concatenation in `src/build/assemble.mjs`
- [ ] TaxVault taxonomy frozen into `examples/taxvault.config.mjs`
- [ ] `meta.schemaVersion = 1`
- [ ] `meta.acquisition` (`worktree` / `ref` / `fs`, + `ref`, `commit`, `dirty`)
- [ ] **Gate:** payload byte-identical to the prototype except `generatedAt`
  - reference sha256 `d6e8cc0109f7e76f0ff7c22fcb4fad0e6bf692feb9cb21c992d423f352d31902` (197 nodes / 467 edges / 18 endpoints / 9 flows)

## Phase 1 — Renderer: perf, rotation, decoupling

*Moved ahead of the scanner work: the `RangeError` is a crash, and every later view builds on this renderer.*

- [ ] `RangeError` fix — `reduce` instead of `Math.min(...pts.map())` (currently dies ~8k nodes)
- [ ] World-space static cache + mip re-render (cache is currently invalidated by every pan frame, buying nothing)
- [ ] Cached label widths; edges bucketed by style instead of `save()/restore()` per edge
- [ ] `Set` for endpoint dedupe (O(E²) → O(E)); `Map` for group lookup (O(N·G) → O(N))
- [ ] `heightOf` → `8 + 130·log1p(loc)/log1p(p95)` (currently saturates at ~958 LOC)
- [ ] Theme single-sourced into JS tokens; **`style.css` contains zero hex literals** (build-time grep enforces)
- [ ] `VIEWS`, `EDGE_STYLE`, `PACKET_COLOR`, `COVER_TINT`, hint copy → moved into the payload
- [ ] **Camera rotation**: yaw-parameterized projection, generalized depth sort, conditional face visibility, `reproject()` split from `relayout()`
- [ ] Rotation controls: `Q`/`E` 15° steps, Shift+drag free, `R` snap to 45°, yaw in the overlay
- [ ] **Gate:** 60 fps sustained drag on the largest target
- [ ] **Gate:** synthetic 5,000-node / 12,000-edge payload renders, no `RangeError`
- [ ] **Gate:** `grep -r 'engagement\|taxvault\|SUITES", "4' src/viewer/` returns zero hits
- [ ] **Gate:** yaw 45° is bit-identical to Phase 0; 360° sweep never mis-occludes; click selects correctly at every angle

## Phase 2 — Config, detection, graceful degradation

- [ ] `src/config/{defaults,detect,load,init}.mjs`; precedence: defaults < detected < config file < CLI flags
- [ ] Service auto-detection from manifests, run over the **filtered** file list (build artifacts like `.next/package.json` must not register as services)
- [ ] **Total `serviceOf`** — an explicit fallback service always exists (kills the blank-screen failure)
- [ ] Directory-derived layer fallback; `unsorted` share reported
- [ ] No tests → `coverage: null` everywhere; suite count from `meta`
- [ ] Acquisition ladder: worktree → git ref → plain fs; HEAD fallback
- [ ] Curated-flow validation demoted to a warning; `--strict` restores the hard fail
- [ ] **Classification provenance** — every node records the rule that placed it, shown in INSPECT
- [ ] `atlas scan` diagnostics report
- [ ] Streamed progress to stderr, throttled, suppressed when not a TTY
- [ ] `atlas init` writes a starter config (the only command that writes to a target repo)
- [ ] **Gate:** `atlas build` with **no config** yields a legible atlas for taxvault, Shuttrr, terra, sonder *(not a valid git repo)*, llmbench *(pyproject only)*
- [ ] **Gate:** for each — `nodeCount > 0`, `services.length ≥ 1`, every node's service ∈ services

## Phase 3 — Language adapters + conformance

- [ ] Adapter interface documented in `docs/adapters.md`; `resolve()` returns an **array** of ids (Go packages / Java wildcards are one specifier → many files)
- [ ] `fixtures/hostile-ts/` — barrel chains, `export * from`, aliased re-exports, circular imports, `@/` alias, extensionless, side-effect, `require()`, dynamic `import()`, `.tsx`
- [ ] `fixtures/hostile-py/` — relative-dot imports at several depths, `__init__.py` re-export barrels, `from . import x`
- [ ] Conformance test asserting **exact** expected resolution for both fixtures
- [ ] `src/adapters/ts.mjs` — tsconfig `paths`/`baseUrl`, workspace names, extension swap, all four import forms
- [ ] `src/adapters/py.mjs` — module roots, generalized barrels, **relative-dot imports**
- [ ] `src/adapters/generic.mjs` — no edges, still renders
- [ ] Import line numbers recorded; comment/string blanking before extraction
- [ ] **Gate:** both fixtures resolve exactly as asserted
- [ ] **Gate:** Shuttrr `unresolved === 0`, zero internal specifier classified external (`@/lib/utils/cn` ×174)
- [ ] **Gate:** llmbench — **all 172 relative-dot imports resolve** (currently 0 of 172)
- [ ] **Gate:** TaxVault 350 resolved / 0 unresolved / 320 external, unchanged

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

## Open questions

- **Desktop app** — raised but the message was truncated. Needs resolving before it influences any phase: a desktop shell (Electron/Tauri) conflicts directly with the zero-dependency, no-bundler constraint that the rest of this plan is built on. Worth deciding deliberately rather than drifting into.
