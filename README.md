# code-atlas

Isometric, interactive maps of a codebase — its structure, how requests move through it, what the tests reach, and what's structurally wrong with it.

> **Status: pre-alpha.** All five commands — `build`, `scan`, `init`, `serve` and
> `findings` — work on any repository, with or without a config.
>
> See **[PLAN.md](./PLAN.md)** for the design and **[ROADMAP.md](./ROADMAP.md)** for
> progress. Individual structural decisions are recorded as
> **[ADRs](./docs/adr/)**.

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

Zero runtime dependencies. No bundler. Node ≥ 20.

## License

MIT
