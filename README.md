# code-atlas

Isometric, interactive maps of a codebase — its structure, how requests move through it, what the tests reach, and what's structurally wrong with it.

> **Status: pre-alpha.** `atlas build`, `atlas scan`, `atlas init` and `atlas serve`
> work on any repository, with or without a config. `findings` doesn't exist yet.
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

## Commands

```
atlas build     # -> a single self-contained HTML atlas
atlas scan      # what the scanner found, and what it couldn't
atlas init      # write a starter config by inspecting the repo
atlas serve     # local viewer on 127.0.0.1, with read-only source reading
atlas findings  # cycles, layering violations, orphans, untested endpoints   (planned)
```

Common flags: `--repo PATH` (default `.`), `--config FILE` (optional — atlas
detects otherwise), `--ref REF` (git ref, or `worktree` / `fs`; default `HEAD`),
`--json` (print the payload instead of writing HTML). `serve` also takes
`--port` (default `4173`) and `--open`. Full list: `node bin/atlas.mjs --help`.

Zero runtime dependencies. No bundler. Node ≥ 20.

## License

MIT
