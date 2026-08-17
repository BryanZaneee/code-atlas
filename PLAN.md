# code-atlas — implementation plan

> Canonical plan. Progress is tracked in [ROADMAP.md](./ROADMAP.md).

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | **Node.js ≥ 20** (dev on 24.18.0), ESM `.mjs` | `.mjs` runs as ESM with no `package.json` ceremony |
| Dependencies | **Zero runtime deps.** `node:child_process`, `node:fs`, `node:http`, `node:os`, `node:path`, `node:url`, `node:zlib` | no install step, no supply chain, no version drift |
| Build | **None.** No bundler, no TypeScript, no transpile | the tool must stay readable by whoever is debugging it at 3am |
| Source acquisition | worktree → `git archive <ref>` → plain fs | read-only; never mutates the target or switches branches |
| Viewer | **Vanilla JS + Canvas 2D + CSS custom properties** | no framework, no CDN, no external fetch — works over `file://` |
| Rendering | Yaw-parameterized axonometric projection, painter's-algorithm depth sort, DPR-aware backing store, world-space static cache | 120 fps at DPR 2 today |
| Output | One self-contained HTML + a versioned JSON payload | shareable artifact; `--json` is a public contract |
| Parsing | **Regex, not AST** | zero-deps. Accepted cost — see Limitations |

## Current features (inherited from the TaxVault prototype)

**Scanner** — read-only git-ref acquisition; 153 files / 15,117 lines / 467 edges / 18 endpoints / 53 tests across 4 suites; import graph at **350 resolved, 0 unresolved**; Python barrel re-targeting; endpoint collision qualification; suite classification read from `vitest.*.config.ts`; three-state import-derived coverage (50 direct / 21 indirect / 9 unreachable); curated-flow validation.

**Layout** — services as rows, layers as columns, LOC as height; deterministic, overlap-free; district + service ground plates; exact depth sort; second-pass label collision drop-out.

**Views** — STRUCTURE, API FLOW, ENGAGEMENT (48-step cross-service trace), TESTS.

**Interaction** — pan, cursor-anchored zoom, click-to-inspect, hover, text filter, service toggles, animated Bézier packets, PAUSE / STEP-one-hop / 0.25–4× speed, click-a-packet-for-payload.

---

## Why this exists

Reading a repo file-by-file doesn't build a mental model of it. What's missing is the shape: which parts talk to which, how a request actually moves through the layers, and where the tests reach. This tool draws that, for any repo, and lets you drive a request through it instead of just reading about one.

## The honesty contract

This is the tool's central claim and it constrains every feature below.

| Shown | Status |
| --- | --- |
| Files, sizes, directories | **Observed** — read from disk |
| Import edges | **Observed** — parsed from source (regex; under-reports, see Limitations) |
| Endpoints and their mount prefixes | **Observed** — statically resolved through the router graph |
| HTTP response, status, latency (live mode) | **Observed** — a real request really was sent |
| **The internal path a request takes** | **MODELED** — inferred from imports. Never observed. |
| Per-hop timing | **Never rendered.** We don't have it and must not imply we do. |

Rules that fall out of it: the UI word is **path**, never "call chain"; derived paths carry `DERIVED · NOT VERIFIED` **on the canvas**, not only in a panel; buttons read `SEND (MODELED)` / `SEND (LIVE)`; a non-2xx live response **halts the animation at hop 1** rather than animating a success path under a 500.

---

## Repo structure

```
code-atlas/
  PLAN.md · ROADMAP.md · README.md · LICENSE · CONTRIBUTING.md
  package.json              bin:{atlas}, engines>=20, NO dependencies field
  bin/atlas.mjs             subcommand dispatch (node:util parseArgs)
  src/config/               defaults · detect · load · init
  src/scan/                 source · walk · graph · progress
  src/model/                layers · endpoints · tests · derive · findings · metrics · diagnostics
  src/adapters/             index · ts · py · generic          <- the contribution surface
  src/serve/                server · files · proxy
  src/build/                assemble · embed
  src/viewer/               00-theme … 90-boot, index.html, style.css
  docs/                     payload-schema.md · adapters.md · config.md
  fixtures/                 hostile-ts/ · hostile-py/          <- conformance fixtures
  examples/                 taxvault.config.mjs · shuttrr.config.mjs
  tools/calibrate.mjs       derived-vs-curated diff harness
```

```
atlas build [--repo .] [--config f] [--ref R] [--out atlas.html] [--json] [--embed-source [glob]] [--gzip-source]
atlas serve [--repo .] [--port 4173] [--target URL] [--allow-live] [--auth-env VAR] [--open]
atlas init  [--repo .]     # the ONLY command that writes to the target repo
atlas scan  [--repo .]     # human-readable diagnostics
atlas findings [--repo .]  # code findings (cycles, hotspots, orphans, untested endpoints)
```

**`src/model/` is a directory boundary on purpose.** The seam: *anything that turns a specifier string into a file path is language-specific; everything after the edge list exists is not.* `src/adapters/` owns the former, `src/model/` the latter.

**The viewer is concatenated in both modes.** Top-level `const` is script-scoped, so separate `<script src>` tags would work in `build` (one script) and break in `serve` (many) — a mode-dependent bug class. `serve` concatenates per request; `build` once.

---

## Payload is a public contract

`--json` will be written against by other people, so the payload is versioned from day one.

- `meta.schemaVersion` — integer, starts at `1`. Bumped on any breaking field change; additive fields don't bump.
- `docs/payload-schema.md` documents every field, with the stability tier per field (`stable` / `experimental`).
- `meta.acquisition` — `"worktree" | "ref" | "fs"` plus `ref`/`commit`/`dirty`. **Surfaced in the UI**, because a worktree or plain-fs scan includes uncommitted work and the picture is therefore not reproducible from any commit. A `WORKTREE · UNCOMMITTED` badge is the difference between a screenshot you can trust and one you can't.
- `meta.generatedAt` is the only field allowed to vary between two runs of the same input.

---

## Failure modes being fixed

Confirmed against real repos — this is what the prototype does on anything that isn't TaxVault.

| # | Behavior | Fix |
| --- | --- | --- |
| 1 | **Flat single-package repo → blank screen.** `serviceOf` returns `"other"`, which isn't in `SERVICES`, so every node is filtered out — and `renderServices` only iterates `ATLAS.services`, so there's no checkbox to recover. | `serviceOf` becomes **total**; assert every node's service ∈ services at scan time |
| 2 | **No tests** → every file `coverage:"none"`, whole view orange, beside a hardcoded `["SUITES","4"]` | no test files → `coverage: null`; suite count from `meta` |
| 3 | **Monorepo workspaces** → `@myorg/core` classified external, every intra-repo edge lost | tsconfig `paths`/`baseUrl` + workspace-name resolution |
| 4 | **No layer rule matches** → everything `"tooling"`: one column, one color, coverage skipped | directory-derived fallback + `unsorted` share reported |
| 5 | **Non-git dir or no `origin/develop`** → hard `exit(1)` (`sonder` is exactly this) | acquisition ladder + HEAD fallback |
| 6 | `Math.min(...pts.map())` spreads 8×nodeCount args → **`RangeError` crash ~8k nodes**; `drawStatic` re-runs every pan frame; `endpoints.some()` O(E²); `groups.find()` O(N·G) | `reduce`; world-space cache with mip re-render; `Set`/`Map` |
| 7 | `heightOf` saturates at ~958 LOC — 1,000-line and 5,000-line files identical | `h = 8 + 130·log1p(loc)/log1p(p95)` normalized to the repo |
| 8 | Stale curated flow → `exit(1)`; fatal for a generic tool | warning; `--strict` restores the hard fail |
| 9 | **`PY_FROM` requires `[A-Za-z_]` as the first char, so it cannot match a leading dot.** `llmbench` has **172 relative-dot imports** — all currently invisible | relative-import resolution in the Python adapter |

---

## Design

### Endpoint extraction v2

Verified against Shuttrr, which breaks the current extractor three ways.

**Mounts are transitive — a fixpoint, not one pass.** `app.ts` has `app.route("/api/ai", aiRouter)`; `routes/ai/index.ts` then does `aiRouter.route("/", presetsRouter)` seven more times; `ai/edits.ts` declares 12 routes. **`POST /api/photos/upload` appears in neither `app.ts` nor `photos.ts`.** A single-hop resolver stops at `/api/ai`.

**Resolve to a file, not an object.** `ai/presets.ts` does `const router = new Hono()` then `export { router as presetsRouter }`. The obvious design tracks router-object identity through an aliased re-export; you don't need to. The importing file names `presetsRouter`, that resolves to a **file**, and every route declared in that file inherits the prefix. The local variable name is irrelevant. Biggest simplification in the design.

**Helper-registered routes are invisible to regex, and the answer is not "parse harder."** `ai/presets.ts` has zero `router.post(` calls — it calls `simplePhotoEndpoint(router, {path:"/white-background"})` eight times, with the real registration in `_shared.ts` under a non-literal path. So: **never match a non-literal path** (that emits a phantom endpoint), **count and report** the skips, and keep the rule schema data so a user can teach it in three lines.

Plus file-based routing (Next.js `(groups)` are not URL segments; `[param]` → `:param`; `route.ts` vs `page.tsx`), normalization so `:id` and `{id}` collapse to one logical node, and a **line number per route** — which is what makes jump-to-line work.

### Language adapters — the contribution surface

This is how the project gets languages it didn't pay for, so the interface is a documented deliverable, not an internal detail.

```js
export default {
  id: "ts",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  // text -> [{ spec, symbols?, line, kind: "static"|"side-effect"|"dynamic"|"require" }]
  extractImports(text, path, ctx),
  // spec -> { kind: "internal"|"external"|"unresolved", ids: string[] }   ids is an ARRAY:
  // Go packages and Java wildcards are one specifier -> many files.
  resolve(fromPath, spec, ctx),
  countExports(text),            // optional; omit and the metric is hidden
  entryNames: [...],             // optional
};
```

An adapter that returns **no** edges (Swift, idiomatic Rails) must degrade to a legible atlas rather than an empty one — structure, sizes, and endpoints still render.

**Conformance test + fixtures.** `fixtures/hostile-ts/` and `fixtures/hostile-py/` are small hand-built repos with *known-correct expected output*, deliberately exercising what kills regex: barrel re-export chains, `export * from`, aliased re-exports, circular imports, `@/` aliases, extensionless imports, side-effect imports, `require()`, dynamic `import()`, `.tsx`; and on the Python side relative-dot imports at several depths, `__init__.py` re-export barrels, and `from . import x`. `npm test` runs every adapter against them and asserts exact resolution. A contributor's first move is copying a fixture.

### Findings engine — what the tool says about *your* code

`atlas scan` diagnoses the tool. Nothing yet diagnoses the codebase. This is the recommendations layer, and it is a first-class view, not a footnote.

Findings run over the graph and are all **structural** — no style opinions, nothing that needs an AST:

| Finding | Basis |
| --- | --- |
| Import cycles | SCC over the import graph (Tarjan), reported smallest-first |
| Layering violations | an edge whose target rank is *lower* than its source (e.g. repository → controller) |
| Oversized files | LOC past a configurable threshold, ranked, relative to the repo's own p95 |
| Endpoints no test reaches | endpoint → derived path ∩ test-reachable set = ∅ |
| Orphans | zero in-edges and zero out-edges, excluding entrypoints and configured roots |
| Unreachable from any entrypoint | reverse-BFS from entry-layer nodes |
| God nodes | in-degree past a percentile threshold — the files everything depends on |
| Cross-service coupling | direct edges that bypass the declared service boundary |

Each finding carries `severity`, the **evidence** (the exact nodes/edges), and a one-line "why this matters". They render as a FINDINGS view that highlights the implicated blocks in place — seeing a cycle drawn on the map is the point. `atlas findings --json` makes it CI-able. Thresholds are config, and every finding can be muted with a reason.

### Path derivation + calibration

Most repos have zero curated flows, so derivation makes curation an *enhancement* rather than a requirement.

```
0. Seed with the mount chain (statically PROVEN wiring) — certainty:"wired".
1. BFS from endpoint.definedIn over internal import edges: depth ≤ 6,
   rank non-decreasing, layer not skipped, not already admitted.
2. Sort by (rank, depth, inDegree desc, path); one step per adjacent pair.
   Real edge → solid, certainty:"imported". Gap → dotted, inferred:true.
3. Terminals: a file with a datastore edge terminates into it with the NEUTRAL
   kind "io" — we cannot tell read from write statically, so we don't guess.
4. Response leg: reverse, ≤3 hops, all inferred.
```

**Seed from the handler, not the file** — the highest-value 30 lines here. A route file imports 15 things; only some are on *this* endpoint's path. Slice the text from the route's line to the next route declaration, collect identifiers, seed the BFS only with imports whose symbols intersect. That's the difference between a plausible path and a shotgun.

**Calibration is a script, and it runs before any composer UI exists.** `tools/calibrate.mjs` diffs the derived path against **every** curated flow — all 9, not one — and emits precision/recall per flow plus an aggregate: which hops derivation invented, which it missed, which it got in the wrong order. One endpoint is an anecdote; nine is a measurement. Its output ships in the README so expectations are set *before* first use, and it becomes a regression test — derivation changes must not regress the aggregate.

Derived at scan time, stored as integer node indices. Every solid hop opens the exact import line that justifies it — auditable in two clicks. `[+ CURATE THIS]` copies a ready-to-paste config entry.

### Classification provenance

Every node records **why** it landed where it did: `layer: "service" — matched rule #4 src/services/**`, `service: "api" — matched root apps/api`, `testKind: "integration" — matched vitest.integration.config.ts include[0]`. Shown in INSPECT. This turns "the tool put my file in the wrong column" from a bug report into a config edit, and it is the single cheapest thing that makes a heuristic tool trustworthy.

### Camera rotation

The projection generalizes to a yaw parameter; the layout never moves.

```js
const K = TH / TW;                         // 0.5 — the 2:1 pitch, held fixed
const S = (TW / 2) / Math.cos(Math.PI/4);  // yaw=45° reproduces today's view exactly
A = { x:  Math.cos(yaw) * S, y: Math.sin(yaw) * S * K };   // screen vector for +gx
B = { x: -Math.sin(yaw) * S, y: Math.cos(yaw) * S * K };   // screen vector for +gy
project(gx, gy, h) => ({ x: gx*A.x + gy*B.x, y: gx*A.y + gy*B.y - h });
```

At `yaw = 45°`, `project(1,0,0) = (32,16)` — bit-identical to today, so rotation ships without changing the default view. Three consequences, and only three:

- **Depth sort generalizes.** `gx+gy` is correct only at 45°. The general key is the **max screen-y of the box's four ground corners** (its nearest corner), which reduces to today's ordering at 45°.
- **Face visibility becomes conditional.** Draw the `+gx` face when `A.y > 0`, else the `−gx` face; likewise `gy` via `B.y`. Covers all four quadrants instead of assuming one.
- **Reprojection is not relayout.** Split `reproject()` (face polys, top centers, depth order — sub-ms) from `relayout()` (repack districts, plates). **Hit testing needs no change**, since it already inverse-transforms to world space and ray-casts cached polygons.

Controls: `Q`/`E` and `⟲ ⟳` rotate 15°; **Shift+drag** rotates freely; `R` snaps to 45°. The static cache is keyed on yaw; a rotate-drag bypasses it and rebuilds on release, exactly as pan-drag does.

### `atlas serve`

`listen(port, "127.0.0.1")` — **the bind host is hardcoded, not a flag.**

**Path traversal is defended with an allowlist, not sanitization.** The scan already produced the exact set of files we will serve; `allow.has(rel)` *is* the defense — sanitizing a user string is the losing game, set membership isn't. On top: re-resolve and compare, `lstat` (not `stat`) to refuse symlinks, size cap, always `text/plain` so nothing from the repo is interpreted as markup. Symlinks are also skipped during the walk so they never enter the set. The file endpoint exists **only** in serve mode. Plus a `Host` check and `Sec-Fetch-Site` rejection — DNS rebinding is the specific attack on a loopback dev server.

**Why a proxy at all:** viewer on `127.0.0.1:4173`, app on `:3000` — different origin, so browser `fetch` is blocked and `Authorization` adds a preflight; in `build` mode the origin is `null`. Requiring you to change your app's CORS config so a visualization tool can call it is unacceptable. Server-side fetch has no CORS.

**Not an open relay:** the proxy takes `{method, path, headers, body}` — **no host, no URL**. Target origin comes from server config; the final URL is asserted against it. `--allow-live` required at the *process* level. Target must be loopback/private unless explicitly overridden. Method + header allowlists, timeout, 256 KB cap, `redirect:"manual"`, rate bucket, one stderr line per proxied request.

**Auth token stays out of the browser.** `--auth-env AUTH_TOKEN`; the server injects the header, the viewer shows `AUTH: from env` and offers no field. Fallback is `sessionStorage` (never `localStorage`) with explicit clear. `[ COPY AS cURL ]` verifies what would be sent *without sending it*.

### Code viewer

INSPECT gains `INFO | SOURCE`. 310px is unreadable for code, so SOURCE opens as a wide right-docked overlay (`min(760px, 55vw)`, resizable, `Esc` closes) with the canvas rendering behind. Line gutter, target line highlighted and centered. Jump-to-line from: an endpoint's route definition, an import edge's line, a test's subject, and **a derived hop's justifying import**.

Highlighter is ~60 lines: one alternation regex per language, one `exec` loop, escape as you emit — never `innerHTML` on raw source. Ships ts/js/tsx, py, sql, json. Not doing correct nesting or JSX-aware coloring; a wrong color is a cosmetic bug, not a lie.

**Static mode.** Default shows *"Source is not embedded. Run `atlas serve`, or rebuild with --embed-source."* `--embed-source [glob]` opts in, and the consequence is stated plainly: **the shareable HTML then contains your entire codebase.** `--gzip-source` stores it as a base64 gzip blob inflated with `DecompressionStream("gzip")` — both `node:zlib` and `DecompressionStream` are built in, so it stays zero-dep, and source text compresses ~4×. Shuttrr's 24.6k lines goes ~950 KB → ~240 KB. Costs `view-source` legibility and an async boot step, so it's a flag, not the default. A permanent `SOURCE EMBEDDED` footer badge and a CLI size warning either way.

### Progress reporting

A 500k-line first scan is indistinguishable from a hang. Not a job queue — just streamed stderr progress: `walk 1,240 files · parse 890/1,240 · resolve · endpoints · derive`, throttled to ~10/s, suppressed when not a TTY (so `--json` stays clean). Under `serve`, the same phases stream to the browser over the initial fetch so the first paint isn't a blank page.

### District hierarchy

Districts carry `parentId` from the start — one nullable field, populated with the service id today. The nested-district layout that consumes it is deliberately deferred, but adding the field now means that rewrite doesn't also break the payload contract.

---

## Phases

Reordered from the original: **perf moved into Phase 1**, because the `RangeError` is a crash and every later view builds on that renderer. Derivation and its calibration land **before** any composer UI.

| # | Work | Gate |
| --- | --- | --- |
| **0** | Skeleton, lift-and-shift, viewer concat, `schemaVersion`, `meta.acquisition`, TaxVault taxonomy frozen into `examples/taxvault.config.mjs` | Payload **byte-identical** to the prototype except `generatedAt`. Turns "I hope nothing changed" into a diff. |
| **1** | **Renderer**: `RangeError` fix, world-space cache + mip, `Set`/`Map` for the O(n²) loops, `heightOf` log-p95, theme single-sourced (zero hex in CSS), `VIEWS`/`EDGE_STYLE`/copy into payload, **camera rotation** | 60 fps drag on the largest target; synthetic **5,000-node / 12,000-edge** payload renders with no `RangeError`; `grep -r 'engagement\|taxvault\|SUITES", "4' src/viewer/` = zero hits; 360° rotation never mis-occludes; hit-testing correct at every angle; yaw 45° bit-identical to Phase 0 |
| **2** | Config, precedence, detection, `atlas init`, total `serviceOf`, layer fallback, graceful degradation, classification provenance, `atlas scan`, streamed progress | `atlas build` with **no config at all** yields a legible atlas for taxvault, Shuttrr, terra, **sonder** (no valid git), **llmbench** (pyproject only). Assert `nodeCount>0` and every node's service ∈ services. INSPECT shows the matched rule for every node. |
| **3** | Adapters + resolution + **conformance fixtures** | `fixtures/hostile-ts` and `fixtures/hostile-py` resolve **exactly** as asserted. On Shuttrr `unresolved===0` and zero internal specifier classified external (`@/lib/utils/cn` ×174). On **llmbench all 172 relative-dot imports resolve** (currently 0). TaxVault counts unchanged. |
| **4** | Endpoints v2 | Shuttrr yields `POST /api/photos/upload`, `GET /api/photos/gallery`, `GET /health`, ≥12 `/api/ai/*` through the two-level mount, `/sign-in`, `/auth/callback`; `(auth)`/`(dashboard)` absent from every path; ≥8 non-literal registrations reported naming `presets.ts` |
| **5** | Findings engine + FINDINGS view + `atlas findings --json` | On TaxVault: reports `core-case-service` orphans and `server.ts` unreachable-from-tests (both known-true); zero false layering violations against a repo that enforces layering by policy. Cycles found in a synthetic fixture with a known cycle. |
| **6** | Derivation + `tools/calibrate.mjs` | Every endpoint across all targets gives a ≥2-hop path with no crash. **Calibration diffs derived vs curated across all 9 flows**, emits per-flow and aggregate precision/recall, and the numbers go in the README. |
| **7** | `atlas serve` + code viewer + `--embed-source` + `--gzip-source` | Traversal list all 404: `../../../etc/passwd`, `/etc/passwd`, `.env`, `node_modules/x`, in-repo symlink pointing out, `..%2f..%2f`, `Host: evil.example`. Clicking `POST /api/photos/upload` opens `photos.ts` at line 12. Gzip round-trips and cuts embedded size ≥3×. |
| **8** | Request composer UI | Compose → `SEND (MODELED)` animates the derived path with substituted values; curated-vs-derived badge visible on canvas; `[+ CURATE THIS]` output pastes into a config and validates |
| **9** | Live mode | Real 200 + latency from a running Shuttrr; 401 halts at hop 1 and says so; proxy refuses `path:"http://example.com/"`, refuses non-loopback target, 403s without `--allow-live`; no token in stderr or `outerHTML` |
| **10** | Open-source packaging | README, LICENSE, CONTRIBUTING, `docs/{payload-schema,adapters,config}.md`. Gate: a reader who has never seen the repo goes from `git clone` to a rendered atlas of **their own** project using only the README, on a repo with no config. |

## Limitations (stated up front, and in the README)

Regex, not AST — under-reports, quantified by the conformance fixtures. File-level, not call-level. Internal request paths are **inferred, never observed**. Same-package references without imports (Go, Java, Rails autoloading) are systematically invisible. Endpoint extraction misses non-literal registrations by design, and reports the count.

## Explicitly deferred

Real tracing / OTel / per-hop timings · AST parsing · call-graph analysis · a bundler or TS for the tool itself · WebGL · persisted layouts / URL state · multi-repo & multi-commit diffing · adapters beyond TS/Python at launch (`generic.mjs` still renders them) · OpenAPI import · nested-district layout (the `parentId` field ships, the layout doesn't) · **any writing to the target repo beyond `atlas init`** · auth flows in the composer.

Scope guard: the code viewer is read-only with no search and no editing; the composer has no collections, environments, or scripting. If a request is "like Postman" or "like VS Code", the answer is no.
