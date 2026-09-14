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
- **Never emit a phantom endpoint.** A route registration whose path is not a
  string literal is skipped and counted, never guessed at.
- **Nothing target-specific in `src/` or `bin/`.** The repos this tool is
  validated against are a validation corpus, not fixtures: real, messy code
  that proves the visualization holds up, never encoded into the tool itself.
  `test/generic.test.mjs` greps `src/` and `bin/` for a denylist of corpus repo
  names and asserts zero hits. When a target's gate fails, the fix is in config
  or detection, never a special case. The reviewable question on any change is
  *would this be right on a repo I have never seen?*

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
| the payload gains or changes a field | `docs/payload-schema.md` + re-baseline the golden |
| an adapter's interface changes | `docs/adapters.md`, it is an API change |
| a config key is added | `docs/config.md` |

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
