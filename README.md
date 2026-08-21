# code-atlas

Isometric, interactive maps of a codebase — its structure, how requests move through it, what the tests reach, and what's structurally wrong with it.

> **Status: pre-alpha.** All five commands — `build`, `scan`, `init`, `serve` and
> `findings` — work on any repository, with or without a config. Live mode, the
> one feature that would send a real request, is not built yet: everything the
> tool draws today is either read from the repository or modelled from it.
>
> See **[PLAN.md](./PLAN.md)** for the design and **[ROADMAP.md](./ROADMAP.md)** for progress.

## Why

Reading a repo file-by-file doesn't build a mental model of it. What's missing is the shape: which parts talk to which, how a request actually moves through the layers, and where the tests reach. This draws that, for any repo, and lets you drive a request through it instead of just reading about one.

## Quickstart

No install needed — run it straight from this checkout with Node ≥ 20:

```bash
# from this directory, point it at any repo on your machine
node bin/atlas.mjs build --repo /path/to/your/repo --out atlas.html
open atlas.html   # or just double-click the file
```

That's the whole thing: one HTML file, self-contained, no server required.

To browse with live source reading instead (jump from a node to the file
that produced it), run the local server and open the URL it prints:

```bash
node bin/atlas.mjs serve --repo /path/to/your/repo --open
```

`serve` binds to `127.0.0.1` only and is read-only on your repo — nothing it
does can write to or modify the code it maps. No config file is required for
either command; without one, atlas detects services and layers on its own.
Run `node bin/atlas.mjs init --repo /path/to/your/repo` first if you want a
starter config to hand-tune instead of relying on detection.

## What is real and what is modeled

The tool can show a **real** HTTP response and a **modeled** internal path in the same frame. Keeping those apart is the central design constraint, not a disclaimer.

| Shown | Status |
| --- | --- |
| Files, sizes, directories | **Observed** — read from disk |
| Import edges | **Observed** — parsed from source (regex; under-reports) |
| Endpoints and mount prefixes | **Observed** — statically resolved through the router graph |
| HTTP response, status, latency | **Observed** — a real request really was sent |
| **The internal path a request takes** | **MODELED** — inferred from imports. Never observed. Calibrated at 17% precision / 12% recall against nine hand-curated flows |
| Per-hop timing | **Never rendered.** We don't have it and won't imply we do. |

### Path derivation, calibrated

The derived path — the row above — is a guess built from the import graph, not
something the tool measured. Here is how good the guess is.

Measured against TaxVault at commit `22595f3a`, across its 9 hand-curated
flows (93 hops a human traced by reading the code): **precision 17%, recall
12%** (tp=11, 52 invented, 81 missed, 1 mis-ordered). Concretely: of the 93
hops curation says are real, derivation found 11; the other 53 hops it output
were either invented (52 — a plausible-looking edge that isn't actually on the
request path) or right but in the wrong order (1). It missed 81 hops outright.

That's one repository and nine flows — a small sample, and a limitation of
this measurement, not a hedge on the result. It ships anyway because most
repos this tool runs against have zero curated flows to derive against in the
first place; there, derivation is the only path shown, not a stand-in for a
better one. A rough map beats no map, but only if you know it's rough —
that's what these numbers are for.

Re-run them yourself with `npm run calibrate`. The suite holds a floor a little
under them — precision 15%, recall 10% — so a change that makes derivation
meaningfully worse fails CI rather than quietly shipping.

## Commands

```
atlas build     # -> a single self-contained HTML atlas
atlas scan      # what the scanner found, and what it couldn't
atlas init      # write a starter config by inspecting the repo
atlas serve     # local viewer on 127.0.0.1, with read-only source reading
atlas findings  # cycles, layering violations, orphans, untested endpoints
```

Common flags: `--repo PATH` (default `.`), `--config FILE` (optional — atlas
detects otherwise), `--ref REF` (git ref, or `worktree` / `fs`; default `HEAD`),
`--json` (print the payload instead of writing HTML). `serve` also takes
`--port` (default `4173`) and `--open`. Full list: `node bin/atlas.mjs --help`.

## Features

**Views.** STRUCTURE for the shape of the codebase, TESTS for what the suite
actually reaches, FINDINGS for eight structural checks drawn on the map rather
than listed beside it, REQUEST for composing a request against an endpoint, and
one view per curated flow plus DERIVED PATHS for the ones the tool inferred.
Curated and derived paths never share a view, because a reader has to be able to
tell an asserted path from an inferred one without inspecting a field.

**The map.** Services are rows, layers are columns, file length is height. Pan,
cursor-anchored zoom, rotation, click-to-inspect, text filter, service toggles,
animated packets with pause and single-step, and districts a reader can drag by
hand. Every block records the rule that placed it, so a misclassification is a
config edit rather than a bug report.

**Reading the code.** `atlas serve` adds a SOURCE tab that opens the file behind
a block at the line that matters: an endpoint's registration, an import, a test's
subject. `atlas build --embed-source` bakes the text into the HTML instead, so a
single file can travel without the repository.

**Composing a request.** Pick an endpoint, fill in its parameters, query, headers
and body, and play the path it would take. Nothing is sent. Each hop says whether
an import backs it, a hop with nothing behind it is drawn dotted and offered no
line to open, and `[+ CURATE THIS]` emits a config entry that turns the tool's
guess into your claim.

## Configuration

None is required. Without a config, services are detected from manifests and
layers from directory names, and every placement still records its reason.
`atlas init` writes a starter config by inspecting the repository.

Two worked examples ship in the repo:

- **`fixtures/mini-monorepo/atlas.config.mjs`** — the small case, where layers
  come straight from directory names and three services are declared outright.
- **`examples/taxvault.config.mjs`** — a five-service polyglot monorepo: custom
  layer rules, endpoint rules with mount prefixes, curated datastores and the
  edges no import expresses.

Every key is documented in **[docs/config.md](./docs/config.md)**.

## Running the servers

`atlas serve` binds `127.0.0.1` and that is hardcoded rather than a flag. It is
read-only on your repository: nothing either command does can write to the code
it maps, and `atlas init` is the only command permitted to write to a target
repo at all.

File access is defended by **allowlist membership** against the exact set the
scan produced, not by sanitizing paths, plus symlink refusal, a size cap, an
always-`text/plain` content type, a `Host` check and `Sec-Fetch-Site` rejection.
The traversal cases are covered verbatim in `test/serve.test.mjs`.

## Tech stack, and why

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node ≥ 20, ESM `.mjs` | runs as ESM with no `package.json` ceremony |
| Build | none — no bundler, no TypeScript | the tool has to stay readable by whoever is debugging it at 3am |
| Viewer | vanilla JS, Canvas 2D, CSS custom properties | no framework and no external fetch, so a built atlas works over `file://` |
| Parsing | regex, not AST | see Limitations. The cost is under-reporting, and it is measured |
| Highlighting | Prism 1.29.0, vendored | a real highlighter without an install step or a bundler |
| Tests | `node:test` | in the runtime already |

There is no npm dependency today, and that is a default rather than a rule. It is
what makes the single-file promise cheap and keeps install friction at zero for a
tool people run against someone else's repository. Where a library earns its
place it gets taken, and vendoring is the third option — Phase 7 took it.

## Limitations

**Imports are read with regexes, not a parser.** Dynamic imports, unusual
formatting and computed specifiers are missed. Under-reporting is the accepted
cost, and `atlas scan` prints what it could not resolve rather than hiding it.

**A non-literal route path is never guessed at.** A route registered through a
helper is skipped and counted, because a phantom endpoint is worse than a
missing one.

**The internal path a request takes is modelled, and the numbers are above:**
17% precision, 12% recall against nine hand-curated flows. That is the honest
size of the guess, and it is in the README rather than a footnote because it
sets expectations before first use.

**Only TypeScript/JavaScript and Python have adapters.** Any other language
still renders — files, sizes, layers and endpoints where the rules match — but
contributes no import edges, and `atlas scan` reports that as a coverage answer.
Adding a language is about thirty lines: **[docs/adapters.md](./docs/adapters.md)**.

**No live traffic, no call graph, no per-hop timings.** Per-hop timing is not a
missing feature, it is a number this tool does not have and will not invent.

## Contributing

**[CONTRIBUTING.md](./CONTRIBUTING.md)**. The constraints that are not up for
negotiation are listed there, and the adapters are the documented place to start.

## License

MIT
