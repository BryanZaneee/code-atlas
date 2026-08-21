# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State of the repo

**Phases 0, 2, 2.5, 2.6, 2.7, 3, 4, 5, 6, 7, 8 and 10 are complete. Phase 9,
live proxy mode, is the only phase left.**

`build`, `scan`, `init` and `serve` all work on any repository, with or without a
config, and `findings` reports the eight structural checks over the graph.
Derivation (`src/model/derive.mjs`) and its calibration
harness (`test/calibrate.mjs`, `npm run calibrate`) are in, and the numbers
they produce are published in the README rather than left in a commit message.
Phase 7 is in whole, including `--embed-source` and `--gzip-source`; its one
open item is the >=3x compression ratio, deferred with a measured 2.31x and the
arithmetic showing the bar was set against a number that forgot base64. Phase 8
ships the request composer, and Phase 10 the packaging: README, CONTRIBUTING and
the three docs, with the cold-reader gate walked against a repo the tool had
never seen.

Phase 1 is done bar one gate — 60 fps sustained drag — which needs a human with
the window in front, because `requestAnimationFrame` is suspended in a
backgrounded tab.

The prototype this was lifted from still lives at `../FedStack/tax-vault-atlas/`.
It is the reference for the Phase 0 baseline and nothing else; do not edit it, and
do not "improve" lifted logic outside the phase that owns the improvement.

## Commands

```bash
# map a repo the tool has never seen — no config, detection fills the gap
node bin/atlas.mjs build --repo PATH
node bin/atlas.mjs scan  --repo PATH      # why the map looks the way it does
node bin/atlas.mjs init  --repo PATH      # a starter config; refuses to overwrite

node bin/atlas.mjs build --repo fixtures/mini-monorepo \
  --config fixtures/mini-monorepo/atlas.config.mjs --ref fs --json

npm test                                  # node --test test/*.test.mjs
node --test test/golden.test.mjs          # a single file
UPDATE_GOLDEN=1 npm test                  # re-baseline, then READ the diff
npm run calibrate                         # test/calibrate.mjs; needs the corpus
```

`--ref fs` scans a directory with no git involved; the acquisition ladder
(worktree → git ref → fs) picks a rung on its own otherwise. Corpus tests skip
when the repo is absent, so `npm test` is green on a fresh clone.

CLI surface, flags, and per-phase gates: **PLAN.md**. Checklists and definition of
done: **ROADMAP.md** — a phase is done when every box is ticked; tick them as you go.

## Standing constraints

Design decisions with reasons in PLAN.md. Most are settled; where one is open
to change, it says so.

- **Dependencies are a decision to make together, not a rule to obey.** Use one
  where it genuinely earns its place — **discuss it first**, before it is added.
  There is no npm dependency today, and the defaults that keep it that way are
  worth keeping by inertia rather than by law: `.mjs` ESM, no bundler, no
  transpile step, and `node:test` for the suite. The costs to weigh out loud are
  the single-self-contained-file promise (which is what makes vendoring ~600 KB
  real) and install friction for a tool people run against someone else's repo.
  **Vendoring is the third option**, and Phase 7 took it: Prism ships as
  `src/viewer/05-prism.js`, committed rather than installed, which buys a real
  highlighter without an install step or a bundler. A vendored file is still a
  dependency — it is tested like anything else in `src/`, and its version and
  licence belong in its header.
  The one hard part: never add a dependency to make one target repo work.
- **Read-only on the target repo.** `git archive <ref>` into a temp dir, or a plain
  fs walk. Never switch branches, never mutate a working tree. `atlas init` is the
  only command permitted to write to a target repo.
- **Regex, not AST.** Under-reporting is the accepted cost and is quantified by the
  conformance fixtures. "Parse harder" is not the answer to a missed pattern —
  skip it, count it, report it.
- **Never emit a phantom endpoint.** A non-literal route path is skipped and counted,
  not guessed at.
- **Nothing target-specific in `src/` or `bin/`.** See below — this one is
  enforced by a test.

## Nothing target-specific in `src/`

The repos this tool is validated against — taxvault, Shuttrr, terra, sonder,
llmbench — are a **validation corpus, not fixtures**. They exist to prove the
visualization and the data flow hold up on real, messy code. They are never
encoded into it. Every value the prototype hardcoded lives in config (shipped as
`examples/*.config.mjs`) or is auto-detected.

`test/generic.test.mjs` greps `src/` and `bin/` for a denylist and asserts zero
hits: `taxvault`, `tax_vault`, `tax-vault`, `shuttrr`, `llmbench`, `terra`,
`sonder`, `engagement`, `drizzle`, `prompt-journal`, `apps/api`, `ingestion-ocr`,
`identity-auth`, `vitest.integration`, `AGENTS.md` — case-insensitive.

When a target's gate fails, the fix is in **config or detection**, never a
special case. The test only catches *named* strings, not a rule quietly shaped
around one repo's directory layout, so the reviewable question on any adapter or
classifier diff stays: *would this be right on a repo I have never seen?*

## Commits and documentation

Conventional commits, 50/72:

- Subject ≤ 50 chars, imperative mood, no trailing period: `<prefix>: <what>`
- Blank line, then body wrapped at 72 chars — what and why, never how
- Prefixes: `feat:` `fix:` `docs:` `refactor:` `test:` `chore:` `perf:` `style:`
  `ci:` `build:` `revert:`
- One logical change per commit; body optional for trivial changes

**A phase is several commits, never one.** Working code and its test land in the
same commit — a `feat:` that a later `test:` covers is two commits that cannot be
bisected apart.

**Documentation moves with the code, in the same commit:**

| when | update |
| --- | --- |
| any box in a phase is finished | tick it in `ROADMAP.md` |
| a phase's gate passes | flip its status marker and the header count |
| the payload gains or changes a field | `docs/payload-schema.md` + re-baseline the golden |
| an adapter's interface changes | `docs/adapters.md` — it is an API change |
| a config key is added | `docs/config.md` |
| a design decision is made or reversed | `PLAN.md`, with the reason |

Goldens under `test/golden/` are re-baselined **deliberately**, in the same commit
as the change that moved them, with the diff read. That is why they are files and
not hashes: a diff says what moved, a hash only says something did.

## The honesty contract

The tool draws observed facts and modelled inferences in the same frame:

| Observed | Modelled |
| --- | --- |
| files, LOC, import edges, endpoints, live HTTP status/latency | the internal path a request takes |

**One rule: never let the second look like the first.** A path this tool inferred
from the import graph has to be legible as inferred, and something the tool does
not measure — per-hop timing, most of all — is not drawn at all.

How that gets expressed in the UI is a design question, not a rule here. Wording,
placement, badge and button copy are all open; earlier drafts of this file pinned
exact strings, which constrained the design without making the map any more
honest. What is not open is shipping a modelled path that reads as an observed
one, or drawing a number we do not have.

## Vocabulary

One word per thing, because the map, the payload, the panels and the README all
have to agree. The axes are **service down, layer across**.

| term | what it is |
| --- | --- |
| **block** | one source file, drawn as an extruded solid; height is file length |
| **prism** | one extrusion inside a block's shape — five shapes are built from prisms |
| **district** | one service crossed with one layer. `districts[]` in the payload, `LAYOUT.districts` in the viewer, id `service/layer` everywhere — built by `districtId()` in `15-helpers.js` and never assembled by hand |
| **service** | a row of the map, with a service plate under it |
| **layer** | a column of the map, ordered by `rank` |
| **ground plate** | the pad under a group of blocks — a **service plate** or a **district plate** |
| **ground grid** | the isometric floor, `S.ground` |
| **packing** | how blocks arrange *within* a district — `S.packing`, grid/wide/tall |
| **density** | how much space sits *between* districts and services |

**Folders are not drawn.** A directory decides a block's layer and service and
then plays no further part. Do not add a directory-shaped visual unit; if files
that sit together on disk land in different districts, that is the map doing its
job.

Retired words, so they do not come back: *group* (say district), *box* and
*building* (say block), and `S.layout` / `S.grid` (say `S.packing` / `S.ground`).

## Architecture — the seams that matter

**`src/adapters/` ↔ `src/model/` is the load-bearing boundary.** Anything that turns
a specifier string into a file path is language-specific and belongs in an adapter;
everything downstream of "the edge list exists" is language-agnostic and belongs in
the model. `resolve()` returns an **array** of ids (one Go/Java specifier → many files).
Adapters are the documented contribution surface, so changes there are API changes.

**The viewer is concatenated in both modes.** `src/viewer/00-*.js … 90-*.js` are joined
into one script — by `src/build/assemble.mjs` once for `build`, and per request by
`src/serve/server.mjs`. Separate `<script src>` tags are not an option: top-level `const` is
script-scoped, so multiple tags would work in `build` and break in `serve`. Any new
viewer file must be safe to concatenate (no duplicate top-level names).

**The payload is a public contract.** `--json` output is versioned by
`meta.schemaVersion` (breaking field changes bump it; additive ones don't) and
documented in `docs/payload-schema.md`. `meta.generatedAt` is the only field allowed
to differ between two runs of the same input — everything else must be deterministic,
which is what makes the Phase 0 byte-identical gate and later regression diffs work.
`meta.acquisition` (`worktree`/`ref`/`fs`) is surfaced in the UI because a worktree
scan includes uncommitted work.

**Data flow:** acquire ref → walk + filter → per-file import extraction (adapter) →
resolve to internal/external/unresolved → classify layer + service + test kind →
build nodes/edges → derive coverage by reverse-reachability from tests → extract
endpoints (mount resolution to a fixpoint) → derive paths → serialize to one JSON
payload → inject into the viewer template at a single marker
(`/*__ATLAS_DATA__*/`, escaping `<`, U+2028, U+2029). Findings slot in after path
derivation when Phase 5 lands; nothing implements them yet.

**Where things live:**

```
src/adapters/  ts · py · index            language knowledge, and the only place for it
src/scan/      source · walk              acquire a ref, walk the tree
src/model/     graph · classify · endpoints · mounts · derive · tests · metrics · chrome
src/build/     build · assemble           the pipeline, and the single-file viewer
src/cli/       report · progress          terminal output; reads a finished payload
src/serve/     server                     loopback viewer + read-only source
src/viewer/    00-… 90-…                  concatenated, in filename order
```

`src/model/chrome.mjs` is the views and theme tables the payload ships to the
viewer — presentation, not facts about the repository. Endpoint extraction asks
`adapterFor()` whether a file is in a language this tool reads, so "no adapter"
is a coverage answer as well as an edge one, and is reported by `atlas scan`.

**Classification is always provenanced.** Every node records the rule that placed it
(`layer: "service" — matched rule #4 src/services/**`) and INSPECT shows it. When
adding any heuristic, carry the reason alongside the result — that is what makes a
misclassification a config edit instead of a bug report.

**Graceful degradation is a requirement, not a nicety.** Every classifier must be
total: no config, no tests, no git repo, no matching layer rule, or an adapter that
returns zero edges must all still produce a legible atlas. A blank screen is the
prototype's #1 documented failure mode (PLAN.md "Failure modes being fixed").

## Server security posture (Phases 7 & 9)

`serve` binds `127.0.0.1` — hardcoded, never a flag. File access is defended by
**allowlist membership** (`allow.has(rel)` against the exact scanned set), not by
sanitizing paths; plus `lstat` symlink refusal, size cap, always `text/plain`, `Host`
check and `Sec-Fetch-Site` rejection. The live proxy accepts `{method, path, headers,
body}` only — **no host, no URL** — with the origin from server config, `--allow-live`
required at the process level, and the auth token injected server-side from
`--auth-env` so it never enters the browser.

## Scope guard

PLAN.md's "Explicitly deferred" list is binding: no AST parsing, no call-graph
analysis, no OTel/real tracing, no multi-repo diffing, no editing. If a request
amounts to "like Postman" or "like VS Code", the answer is no.

**WebGL is no longer deferred.** A shader or three.js renderer is on the table
whenever it is worth building; the renderer keeps a seam so it can be swapped in.
It is not built today — the viewer is Canvas 2D — and taking three.js or
paper-shaders on is a dependency decision, so it follows the rule above: discuss
it first, then do it.
