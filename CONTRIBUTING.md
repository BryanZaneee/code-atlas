# Contributing

Thanks for looking. This is a tool that reads other people's repositories and
draws conclusions about them, and almost every rule below follows from that.

## Getting set up

```bash
git clone https://github.com/BryanZaneee/code-atlas.git
cd code-atlas
npm test                                  # node --test test/*.test.mjs
node bin/atlas.mjs build --repo . --out atlas.html
```

Corpus tests skip when the validation repos are absent, so a fresh clone is
green.

## Posture checklist

The full version is [`docs/posture-checklist.md`](./docs/posture-checklist.md),
and it is the document to read before your first change. In short:

- **Do not leak the target repository.** No scanned source or file contents in
  logs, errors, or stack traces; no secrets in source; `--json` is the
  sanctioned channel; `--embed-source` stays opt-in and badged.
- **Do not overclaim.** Never emit a phantom endpoint; never let a modelled
  path read as an observed one; never draw a number the tool does not measure;
  nothing target-specific in `src/` or `bin/`; every classification carries its
  provenance.
- **Secure defaults.** `serve` binds `127.0.0.1` as a literal; file access is
  allowlist membership, not path sanitization; the proxy takes no host and no
  URL; the tool is read-only on the target repo, `atlas init` excepted.
- **Dependencies are a discussion.** Propose one in the pull request, weighed
  against the single-file promise and install friction. Vendoring is the third
  option. Never add one to make a single target repo work.

## Trunk-based workflow

`develop` is the shared integration trunk. All changes must be made on a
short-lived branch and submitted in a pull request targeting `develop`; do not
commit directly to the trunk. Start each branch from the current `develop`, keep
it focused on one issue or small change, and delete it after the pull request is
merged.

`master` is the release branch and receives pull requests from `develop` alone.
Both are protected: a direct push is refused by GitHub, not by convention.

Use this branch format:

```text
<type>/<issue#>-<short-kebab-description>
```

Allowed types are `feature`, `fix`, `chore`, `docs`, and `test`. They are the
same vocabulary as the commit prefixes below, so a branch and its commits agree.
For
example: `feature/42-ts-migrate-adapters`.

## Commits

Conventional commits, 50/72:

- Subject ≤ 50 chars, imperative mood, no trailing period: `<prefix>: <what>`
- Blank line, then a body wrapped at 72 chars: **what and why, never how**
- Prefixes: `feat:` `fix:` `docs:` `refactor:` `test:` `chore:` `perf:` `style:`
  `ci:` `build:` `revert:`
- One logical change per commit; the body is optional for trivial changes

**Working code and its test land in the same commit.** A `feat:` that a later
`test:` covers is two commits that cannot be bisected apart.

**Documentation moves with the code, in the same commit:**

| when | update |
| --- | --- |
| any box in a phase is finished | tick it in `ROADMAP.md` |
| a phase's gate passes | flip its status marker and the header count |
| the payload gains or changes a field | `docs/payload-schema.md`, then re-baseline the golden |
| an adapter's interface changes | `docs/adapters.md`, because it is an API change |
| a config key is added | `docs/config.md` |
| a design decision is made or reversed | `PLAN.md`, with the reason |

## Goldens

`test/golden/` holds committed payloads, not hashes, so a failure prints a diff
rather than reporting that *something* moved. Re-baseline them **deliberately**,
in the same commit as the change that moved them, and read the diff:

```bash
UPDATE_GOLDEN=1 npm test    # then READ the diff before committing it
```

A golden that moves in a refactor is a bug, not a rebaseline.

## Pull request conventions

Pull requests must target `develop`, remain small enough for effective review,
and use the repository pull-request template. Complete its `Summary`, `Why`,
`Changes`, and `Testing` sections, including the applicable checks and tests
that were run. Complete the checklist before requesting review.

If a pull request changes an architectural decision, create or update the
relevant ADR under [`docs/adr/`](./docs/adr/) and link it in the pull request.
If no architectural decision changes, explicitly mark the ADR item as not
applicable. The threshold is **expensive to reverse**; see
[ADR-0001](./docs/adr/0001-record-architecture-decisions.md).

## Where things live

```
src/adapters/  ts · py · generic · index    language knowledge, and the only place for it
src/scan/      source · walk                acquire a ref, walk the tree
src/model/     graph · classify · endpoints · mounts · derive · tests · metrics
               · chrome · findings
src/cli/       report · progress            terminal output; reads a finished payload
src/serve/     server                       loopback viewer + read-only source
src/build/     build · assemble             the pipeline, and the single-file viewer
src/viewer/    00-… 90-…                    concatenated, in filename order
```

Two seams are load-bearing:

**`src/adapters/` ↔ `src/model/`.** Anything that turns a specifier string into
a file path is language-specific and belongs in an adapter; everything
downstream of "the edge list exists" is language-agnostic and belongs in the
model. Adapters are the documented contribution surface, so changes there are
API changes. See [`docs/adapters.md`](./docs/adapters.md).

**The viewer is concatenated in both modes.** `src/viewer/00-*.js … 90-*.js` are
joined into one script, once by `src/build/assemble.mjs` for `build`, and per
request by `src/serve/server.mjs`. Separate `<script src>` tags are not an
option: top-level `const` is script-scoped, so multiple tags would work in
`build` and break in `serve`. **Any new viewer file must be safe to
concatenate**, with no duplicate top-level names. `test/viewer.test.mjs`
enforces it.

## Adding a language

Copy `src/adapters/generic.mjs`, copy a fixture from `fixtures/hostile-ts/` or
`fixtures/hostile-py/`, and assert the exact resolution you expect,
**including the rows that must come back unresolved.** That is the honesty path, and a
counting test cannot protect it. `docs/adapters.md` walks the interface.

## Scope

PLAN.md's *Explicitly deferred* list is binding: no AST parsing, no call-graph
analysis, no real tracing or per-hop timings, no multi-repo diffing, and no
writing to the target repo beyond `atlas init`. The code viewer is read-only,
with no search and no editing. If a request amounts to "like Postman" or "like
VS Code", the answer is no.
