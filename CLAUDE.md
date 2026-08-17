# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## State of the repo

`src/`, `bin/`, `docs/`, `examples/`, `fixtures/` are **empty directories**. Only
`PLAN.md`, `ROADMAP.md`, `README.md`, `package.json` exist. Phase 0 has not landed.

The working code being generalized lives outside this repo, at
`../FedStack/tax-vault-atlas/`:

```
atlas.mjs            ~570-line scanner + generator (hardcoded to daring-devs-tax-vault)
atlas-template.html  the viewer, one file, vanilla JS + Canvas 2D
flows.mjs            hand-authored request flows, validated against the scan
atlas.html           GENERATED output
```

Phase 0 lifts that here **unchanged** — the gate is a byte-identical payload
(reference sha256 in ROADMAP.md). Do not "improve" prototype logic while moving it;
the improvements are Phases 1–10 and each has its own gate.

## Commands

```bash
node bin/atlas.mjs build --repo .     # once Phase 0 lands
npm test                             # node --test test/   (test/ not created yet)
node --test test/scan.test.mjs       # a single file
npm run calibrate                    # tools/calibrate.mjs (Phase 6)
node ../FedStack/tax-vault-atlas/atlas.mjs [--ref HEAD] [--json]   # the prototype, today
```

CLI surface, flags, and per-phase gates: **PLAN.md**. Checklists and definition of
done: **ROADMAP.md** — a phase is done when every box is ticked; tick them as you go.

## Non-negotiable constraints

These are design decisions with reasons in PLAN.md, not defaults to revisit:

- **Zero dependencies in the CLI and scanner.** Node stdlib only, `.mjs` ESM, no
  bundler, no TypeScript, no transpile step. Tests use `node:test`, so the test
  suite is dep-free too. This is the default, not a law: the *viewer* may take a
  rendering dependency when a phase justifies one (three.js / paper-shaders are
  wanted eventually). Adding one is a deliberate, documented decision — weigh it
  against the single-self-contained-file promise, which is what makes vendoring
  ~600 KB a real cost. Never add a dependency to make one target repo work.
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

The tool renders observed facts and modeled inferences in the same frame, so keeping
them distinguishable constrains code and UI copy alike:

| Observed | Modeled |
| --- | --- |
| files, LOC, import edges, endpoints, live HTTP status/latency | the internal path a request takes |

Consequences that show up as concrete rules: the UI word is **path**, never "call
chain"; derived paths carry `DERIVED · NOT VERIFIED` **on the canvas**, not just in a
panel; buttons read `SEND (MODELED)` / `SEND (LIVE)`; a non-2xx live response halts the
animation at hop 1; **per-hop timing is never rendered** — we don't have it.

## Architecture — the seams that matter

**`src/adapters/` ↔ `src/model/` is the load-bearing boundary.** Anything that turns
a specifier string into a file path is language-specific and belongs in an adapter;
everything downstream of "the edge list exists" is language-agnostic and belongs in
the model. `resolve()` returns an **array** of ids (one Go/Java specifier → many files).
Adapters are the documented contribution surface, so changes there are API changes.

**The viewer is concatenated in both modes.** `src/viewer/00-*.js … 90-*.js` are joined
into one script — by `src/build/assemble.mjs` once for `build`, and per request by
`src/serve/`. Separate `<script src>` tags are not an option: top-level `const` is
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
endpoints (mount resolution to a fixpoint) → derive paths → findings → serialize to
one JSON payload → inject into the viewer template at a single marker
(`/*__ATLAS_DATA__*/`, escaping `<`, U+2028, U+2029).

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
analysis, no OTel/real tracing, no multi-repo diffing, no editing. WebGL is
deferred *until v1.0*, not forever — the renderer keeps a seam so it can be
swapped in later. If a request amounts to "like Postman" or "like VS Code", the
answer is no.
