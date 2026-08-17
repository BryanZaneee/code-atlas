# code-atlas

Isometric, interactive maps of a codebase — its structure, how requests move through it, what the tests reach, and what's structurally wrong with it.

> **Status: pre-alpha, nothing runs yet.** This repo currently contains the plan.
> The working prototype it grows out of lives at `../FedStack/tax-vault-atlas`
> and is hardcoded to a single repository; Phase 0 moves it here unchanged, and
> the phases after that make it general.
>
> See **[PLAN.md](./PLAN.md)** for the design and **[ROADMAP.md](./ROADMAP.md)** for progress.

## Why

Reading a repo file-by-file doesn't build a mental model of it. What's missing is the shape: which parts talk to which, how a request actually moves through the layers, and where the tests reach. This draws that, for any repo, and lets you drive a request through it instead of just reading about one.

## What is real and what is modeled

The tool can show a **real** HTTP response and a **modeled** internal path in the same frame. Keeping those apart is the central design constraint, not a disclaimer.

| Shown | Status |
| --- | --- |
| Files, sizes, directories | **Observed** — read from disk |
| Import edges | **Observed** — parsed from source (regex; under-reports) |
| Endpoints and mount prefixes | **Observed** — statically resolved through the router graph |
| HTTP response, status, latency | **Observed** — a real request really was sent |
| **The internal path a request takes** | **MODELED** — inferred from imports. Never observed. |
| Per-hop timing | **Never rendered.** We don't have it and won't imply we do. |

## Planned

```
atlas build     # -> a single self-contained HTML atlas
atlas serve     # local viewer with source reading and live request replay
atlas init      # write a starter config by inspecting the repo
atlas scan      # what the scanner found, and what it couldn't
atlas findings  # cycles, layering violations, orphans, untested endpoints
```

Zero runtime dependencies. No bundler. Node ≥ 20.

## License

MIT
