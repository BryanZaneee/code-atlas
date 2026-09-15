# Contributing

## Before you start

There is no build step. `node bin/atlas.mjs build --repo .` runs straight off
this checkout, no `npm install`, because there is nothing to install: Node's
standard library is the whole runtime. Node >= 20.

Dependencies are a decision made together, not a rule to obey. There is no npm
dependency today, and `.mjs` ESM / no bundler / no transpile step / `node:test`
for the suite are worth keeping by inertia rather than by law, but the door is
open. Propose one where it earns its place, and open the discussion before you
add it, not after. **Vendoring is the third option**, alongside "add a
dependency" and "write it yourself": Phase 7 shipped Prism as
`src/viewer/05-prism.js`, committed rather than installed, to get a real
highlighter without an install step or a bundler. A vendored file is still a
dependency: it is tested like anything else in `src/`, and its version and
licence belong in its header. The one hard rule underneath the discussion is
this: never add a dependency to make one target repository work.

## Standing constraints

These hold for any change to `src/` or `bin/`:

- **Read-only on the target repo.** Acquisition is `git archive <ref>` into a
  temp dir, or a plain fs walk. Nothing switches branches or mutates a working
  tree. `atlas init` is the only command allowed to write to a target repo.
- **Regex, not AST.** Under-reporting is the accepted cost, quantified by the
  conformance fixtures. A missed pattern gets skipped, counted and reported.
  "Parse harder" is not the fix.
- **The honesty contract.** Observed facts and modelled inferences are drawn in
  the same picture, and the one rule holding that together is that the second
  never reads as the first. Files, lines, import edges, endpoints and live HTTP
  status are observed; the internal path a request takes is modelled, and has to
  stay legible as modelled. A number the tool does not measure — per-hop timing
  above all — is not drawn at all. The rule below is one instance of this.
- **Never emit a phantom endpoint.** A route registration whose path is not a
  string literal is skipped and counted, never guessed at.
- **Nothing target-specific in `src/` or `bin/`.** The repos this tool is
  validated against are a validation corpus, not fixtures: real, messy code
  that proves the visualization holds up, never encoded into the tool itself.
  `test/generic.test.mjs` greps `src/` and `bin/` for a denylist of corpus repo
  names and asserts zero hits. When a target's gate fails, the fix is in config
  or detection, never a special case. The reviewable question on any change is
  *would this be right on a repo I have never seen?*

## Posture checklist

The constraints above are the ones a change to `src/` runs into. The full list,
including the rules about what may leave the process and what the server may
hand out, is [`docs/posture-checklist.md`](./docs/posture-checklist.md). Read it
before your first change. The short version:

- **Do not leak the target repository.** Scanned source and file contents never
  reach stderr, an error message or a stack trace; a path is fine, the line that
  failed to parse is not. No credentials in code, fixtures, examples or tests.
  `--json` is the sanctioned channel, and `--embed-source` stays opt-in and
  badged.
- **Do not overclaim.** No phantom endpoints, no modelled path that reads as an
  observed one, no number the tool does not measure, nothing target-specific in
  `src/` or `bin/`, and every classification carries the rule that placed it.
- **Secure defaults for the server.** `serve` binds `127.0.0.1` as a literal,
  file access is allowlist membership rather than path sanitization, and the
  proxy takes a method, a path, headers and a body, never a host or a URL.
- **Dependencies are a discussion.** Propose one in the pull request body and
  weigh it against the single-file promise and install friction. Vendoring is
  the third option. Never add one to make a single target repo work.

Review a change against that list as well as against the diff: whether a new log
line could carry target-repo content, whether new code hard-codes anything about
a specific repository, whether a new visual element could make an inference look
like a measurement, whether a new heuristic records why it fired, and whether a
new file-serving path went through the allowlist rather than around it.

## The adapters <-> model boundary

`src/adapters/` <-> `src/model/` is the load-bearing seam in this codebase.
Anything that turns an import specifier into a file path is language-specific
and belongs in an adapter; everything downstream of "the edge list exists" is
language-agnostic and belongs in the model. Adapters are the documented
contribution surface, which is how the project gets languages it didn't pay
for, so a change to the adapter interface is an API change, and
[`docs/adapters.md`](./docs/adapters.md) moves with it. Read that file before
touching `src/adapters/` or adding a language.

## Commits

Conventional commits, 50/72:

- Subject <= 50 chars, imperative mood, no trailing period: `<prefix>: <what>`
- Blank line, then body wrapped at 72 chars: what and why, never how
- Prefixes: `feat:` `fix:` `docs:` `refactor:` `test:` `chore:` `perf:`
  `style:` `ci:` `build:` `revert:`
- One logical change per commit; body optional for trivial changes
- No attribution trailers. A commit ends at the body.

**Working code and its test land in the same commit.** A `feat:` that a later
`test:` covers is two commits that cannot be bisected apart.

**Documentation moves with the code, in the same commit:**

| when | update |
| --- | --- |
| any box in a phase is finished | tick it in `ROADMAP.md`, and the phase status and header count with it |
| the payload gains or changes a field | `docs/payload-schema.md` + re-baseline the golden |
| an adapter's interface changes | `docs/adapters.md`, it is an API change |
| a config key is added | `docs/config.md` |

## Branches and pull requests

Branch off `main` and target `main`. Nothing lands on `main` directly — that is
what CI on pull requests is for, and it is the only reason the suite is a gate
rather than a suggestion.

Name the branch `<prefix>/<short-slug>`, using the same prefixes the commits
use: `feat/pack-districts-by-folder`, `fix/rust-mod-resolution`,
`docs/adapter-endpoint-gap`, `chore/quality-sweep`.

Rebase before you open it, and again if review takes a while:

```bash
git fetch origin && git rebase origin/main
npm test
```

A green suite on a stale branch says nothing about the merge.

**The pull request body is `.github/pull_request_template.md`**, which GitHub
fills in for you. Five sections, and each answers a different question:

| section | what goes in it |
| --- | --- |
| **Context** | why this change is being made, from the product side. The problem, not the patch |
| **Description** | how exactly it is accomplished — the steps, the logic, the integration |
| **Changes in the codebase** | the engineering detail: what was added, modified, refactored |
| **Changes outside the codebase** | anything not in this repo — third-party services, settings, infrastructure, a database |
| **Additional information** | what else a reviewer needs: performance, design choices, trade-offs taken |

Delete a section's comment when you fill it in. Leave a section empty rather
than writing "N/A" into it — an empty *Changes outside the codebase* already
says there were none.

No attribution trailers in a PR body, the same as in a commit.

## Tests

```bash
npm test                          # node --test test/*.test.mjs
node --test test/golden.test.mjs  # a single file
UPDATE_GOLDEN=1 npm test          # re-baseline the goldens
```

Goldens under `test/golden/` are files, not hashes, so a failure prints a
diff instead of just "something changed." Re-baseline **deliberately**: run
with `UPDATE_GOLDEN=1`, then read the diff before committing it. A golden that
moved silently is worth more suspicion than a test that failed.

`npm test` must be green on a fresh clone with no setup beyond `git clone`.
Fixtures under `fixtures/` ship with the repo and are what the conformance
tests run against. The validation corpus (taxvault, Shuttrr, terra, sonder,
llmbench) is private to the author and lives outside this repository.
`test/corpus.test.mjs` and `npm run calibrate` skip per repo when it is
absent, rather than failing. If you don't have the corpus, that's expected:
those gates run wherever the repos exist, not in your clone.

## Adding a language

Start at [`docs/adapters.md`](./docs/adapters.md): the interface, what `ctx`
gives you, and a worked example against a real fixture. Two rules that aren't
negotiable: zero dependencies (Node stdlib only, no parser), and determinism
(two runs of one input must be byte-identical, which is what the golden diffs
depend on).

## Scope

`PLAN.md`'s "Explicitly deferred" list is binding: no AST parsing, no
call-graph analysis, no OTel or real tracing, no multi-repo diffing, no
editing the target repo. If a change amounts to "like Postman" or "like VS
Code," it's out of scope here.
