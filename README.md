# code-atlas

Isometric, interactive maps of a codebase — its structure, how requests move through it, what the tests reach, and what's structurally wrong with it.

> **Status: v1.0.** All five commands — `build`, `scan`, `init`, `serve` and
> `findings` — work on any repository, with or without a config. Live mode
> sends a real request when you explicitly turn it on, and is off by default:
> everything else the tool draws is read from the repository or modelled from it.
>
> See **[PLAN.md](./PLAN.md)** for the design and **[ROADMAP.md](./ROADMAP.md)** for progress.

## Why

Reading a repo file-by-file doesn't build a mental model of it. What's missing is the shape: which parts talk to which, how a request actually moves through the layers, and where the tests reach. This draws that, for any repo, and lets you drive a request through it instead of just reading about one.

## Quickstart

Install it once, then run it anywhere:

```bash
npm install -g code-atlas
cd /path/to/your/repo
atlas
```

That maps the repository you are standing in and opens it in your browser. It
reads your working tree, not your last commit, so uncommitted work shows up.

Or run it without installing anything:

```bash
npx code-atlas
```

Either way the result is one self-contained HTML file. No server, no build step,
nothing to host. Send it to someone and it opens.

If a lot of your files land in the UNSORTED column, atlas offers to write a
starter config for you before it finishes. Say yes, edit the file it names, and
run `atlas` again.

To read source alongside the map, jumping from a node to the file that produced
it, start the local viewer instead:

```bash
atlas serve --open
```

`serve` binds to `127.0.0.1` only, and every command except `atlas init` is
read-only on your repository. No config file is required; without one, atlas
detects your services and layers on its own.

Node 20 or newer. To work on atlas itself, clone it and use `node bin/atlas.mjs`
in place of `atlas`.

## What is real and what is modeled

The tool can show a **real** HTTP response and a **modeled** internal path in the same frame. Keeping those apart is the central design constraint, not a disclaimer.

| Shown | Status |
| --- | --- |
| Files, sizes, directories | **Observed** — read from disk |
| Import edges | **Observed** — parsed from source (regex; under-reports) |
| Endpoints and mount prefixes | **Observed** — statically resolved through the router graph |
| HTTP response, status, latency | **Observed** — in LIVE mode, a real request really was sent. Off unless you pass `--allow-live` |
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
line to open, and **CURATE THIS** emits a config entry that turns the tool's
guess into your claim.

## Reading the map

**Position is the taxonomy.** Services are rows, layers are columns. A file's
place is a claim about what it is, and the claim is made by a rule you can read:
click any block and the panel names the rule that put it there.

**Height is lines of code, logarithmically.** A block twice as tall is not twice
as long — the scale is `log1p(loc)` normalised against the repository's own 95th
percentile, so a codebase with one 40,000-line generated file does not flatten
everything else into the floor. Height is comparable within a map and meaningless
between two of them. Endpoints are a fixed short block and datastores a fixed
tall one; for those, height carries nothing at all.

**Colour is identity, not state.** A block's fill is its layer. The `▦ MONO`
toggle removes it entirely and the map still works, because position already
carries the same information. What survives MONO is state: the coverage tint in
the TESTS view, the selection ring, a finding's highlight. That split is
deliberate — identity writes to fill, state writes to stroke and ring and badge,
so turning one off can never turn the other off.

**The rest of the furniture.** The isometric floor is the ground grid. Each
service sits on a plate with a tab naming it; each service-and-layer cell is a
district with a two-character code. Thin static lines are import edges. Moving
diamonds are packets: ambient ones drift along imports to show the graph is
alive, and sequenced ones play a request path in order.

## Controls

| | |
| --- | --- |
| drag | pan |
| **shift**-drag | rotate |
| **alt**-drag | move a district. Snaps to whole cells; a refused drop flashes |
| scroll | zoom, anchored on the cursor |
| `Q` `E` | rotate 15° |
| `R` | reset the camera **and** put every dragged district back |
| `Space` | play / pause the flow |
| `←` `→` | step one hop |
| `Esc` | close the reader, else clear the selection, packet, finding or armed request |
| click | inspect a block, a district, or a moving packet |

## The views

**STRUCTURE** is the whole repository. **TESTS** recolours every block by what
the suite reaches — orange means no test reaches this file at all, a muted tint
means it is reached only indirectly, and normal colour means a test names it
directly. **FINDINGS** veils the map and lights only the blocks and edges one
finding names, in place: it does not re-pack the map, because a finding answers
*where* and moving things would delete the answer.

**Flow views** are different: entering one **isolates** the path and re-packs it
into its own districts, because seeing a path alone is what makes it readable.
Curated paths and derived paths never share a view, so you can always tell from
the strip alone whether a person asserted what you are watching or the tool
inferred it. **REQUEST** is the composer, below.

## The eight structural checks

`atlas findings` prints them; the FINDINGS view draws them on the map.

| check | what it means | severity |
| --- | --- | --- |
| `cycle` | a group of files that import each other in a ring | error at 4+ members, else warning |
| `layering` | an import pointing backwards up the layer stack | error at 3+ layers of distance, else warning |
| `oversized-file` | a file past `locThreshold` (default 400) and well past the repo's own p95 | error / warning / info by how far |
| `untested-endpoint` | an endpoint no test reaches | warning |
| `orphan` | a file with no imports in and none out | info |
| `unreachable` | a file no entrypoint reaches by import | warning |
| `god-node` | a file imported by far more than its peers (default: p95 and at least 5) | error at twice the threshold, else warning |
| `cross-service` | an import crossing a service boundary | warning |

Every threshold is a magnitude, not a verdict: 400 lines says "worth a second
look", not "this is bad". All of them are config keys, and a finding you have
decided to live with can be muted by id — it stays in the payload marked
`muted`, drawn dashed, so silencing one never makes the map quietly incomplete.

## How to tell what the tool knows from what it guessed

This is the part worth reading twice, because the whole design turns on it.

**The canvas badge, top right.** `CURATED · MODELLED PATH` means a person wrote
this path down; the ordering is their claim, and imports cannot express ordering,
so it is still modelled. `DERIVED · NOT VERIFIED` means the tool inferred the
whole thing. `LIVE · STATUS OBSERVED · PATH STILL MODELLED` means a real request
really was sent and came back — and that the hops drawn behind it are exactly as
inferred as they were a moment earlier.

**Solid and dotted hops.** A solid hop has an import edge behind it and the panel
will open the line that justifies it. A dotted hop has nothing behind it, and is
offered no button rather than one that lands somewhere plausible. If the tool
cannot produce the evidence, it downgrades the hop to dotted rather than drawing
a confident line it cannot back.

**`PACKET PAYLOAD (SYNTHETIC)`.** Every payload shown on a hop is invented. Even
in LIVE mode, what you composed is displayed under that heading, because the
request is real but the per-hop payload never was.

**No per-hop timings.** Not "not yet" — the tool never watches a request cross an
internal hop, so any number there would be invented, and inventing it is the one
thing the design forbids outright.

**Authorization is treated as radioactive.** With `--auth-env` the server injects
it and the page is shown only the variable name. Without it, a token you type
lives in `sessionStorage` for that tab and has a CLEAR button. Either way, the
composer's saved fields keep the header *name* with an empty value — a row that
vanished on reload would read as a bug; one that comes back empty reads as a
decision, and only the second is true.

**The footer badge** says where source comes from: served live, embedded in this
file, or not available.

## Composing a request

Pick an endpoint in the REQUEST view, fill in its path parameters, query, headers
and body, and press `SEND (MODELED)`. Nothing is sent: the map plays the path the
request *would* take, curated first and derived otherwise, with each hop marked
by whether an import backs it.

**CURATE THIS** emits a config entry for the path you just watched — paste it
into `flows` and the tool's guess becomes your claim, which is the point.

### Live mode

Off unless you ask for it, and it needs the server:

```bash
atlas serve --repo . --allow-live --target http://127.0.0.1:3000
atlas serve --repo . --allow-live --target http://127.0.0.1:3000 --auth-env AUTH_TOKEN
```

The button becomes `SEND (LIVE)` and the endpoint node gains a status ring and
the round-trip time. A non-2xx **stops the path at the first hop**: the request
reached the endpoint, and everything past that is a route the tool modelled for
a journey that did not finish. Repeat sends accumulate `n`, min, median and p95,
and the p95 is withheld until there are at least five samples, because a 95th
percentile over two numbers is the larger number wearing a statistic's name.

The proxy takes `{method, path, headers, body}` and **no host and no URL** — the
origin is the one you named on the command line, and the page cannot choose a
destination. Targets must be loopback or private addresses, names are never
resolved, redirects are reported and never followed, and **no response body is
ever returned to the page**: you get a status, a duration and a byte count.

## When the map looks wrong

**Run `atlas scan` first.** It prints what the scanner found and what it could
not: unresolved imports, files it has no adapter for, endpoint registrations it
skipped, and how many files fell through to the fallback layer.

**Then click the thing that looks wrong.** Every block records why it landed
where it did. That turns "the tool put my file in the wrong column" into a config
edit rather than a bug report.

| what you see | usually means |
| --- | --- |
| everything in one service | no manifests to detect. Run `atlas init` and edit the `services` it writes |
| a high `unsorted` count | your directory names do not match the default rules. Add `layerRules` |
| no endpoints | routes registered through a helper, or a framework the default rules do not match. `atlas scan` counts what it skipped; add an `endpointRules` entry |
| almost no import edges | a language with no adapter. `scan` reports those files; the map still shows structure |
| a file you just wrote is missing | `--ref` defaults to `HEAD`. Pass `--ref worktree` (or `fs`) to include uncommitted work |
| too dense to read | `theme.density`, the service toggles, or map a subdirectory with `--repo` |
| nothing to play | no curated flows and derivation found no path. The composer says so per endpoint |

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

**No call graph, and no per-hop timings.** Live mode sends one real request and
reports what came back; it does not trace anything inside your application.
Per-hop timing is not a missing feature, it is a number this tool does not have
and will not invent.

**Live mode only reaches your own machine.** Targets must be loopback or private
addresses, and hostnames are never resolved, so `myapp.local` will not work and
`127.0.0.1:3000` will. Checking a name and then connecting to it leaves a window
where the name can move, and refusing is the safer side of that trade.

## Stretch goals

None of this is built. It is written down so the shape of the project is legible
before you open an issue asking for one of them.

### Editor and IDE integration

Atlas already does the reading half of what an editor does. Click a block and the
SOURCE panel shows the real file, syntax highlighted; click an endpoint and it
opens the file at the line the route is declared on. What it does not do is edit,
and that is a decision rather than a gap: `atlas init` is the only command
allowed to write into a repository atlas maps, and the code viewer is read-only
on purpose. The useful direction is a handoff to your real editor, not a worse
copy of one inside a canvas.

- [ ] **Open in your editor.** A control on every block and endpoint that fires
      `vscode://file/<path>:<line>`, with equivalents for Cursor, Zed and the
      JetBrains family. Atlas stays read-only and your editor does the editing.
      Smallest item here and probably the most useful.
- [ ] **A VS Code extension** that hosts the viewer as a panel, so the map sits
      beside the code instead of in a browser tab. A separate package, for the
      same reason a desktop shell would be: the core stays a CLI that writes one
      file.
- [ ] **Watch mode.** `atlas serve --watch` rebuilds as files change, so the map
      keeps up with a refactor instead of going stale behind it.
- [ ] **Deep links into the map.** A URL that opens an atlas already focused on a
      district, a node or a finding, so a map can be cited in a review.

### Distribution

- [x] `atlas` with no arguments maps the repository you are standing in, reads
      the working tree rather than HEAD, and opens the result.
- [x] Offers to write a starter config when most files match no layer rule.
- [ ] **Publish to npm** as `code-atlas`. The package is ready; publishing needs
      an account with rights to the name.
- [ ] **A GitHub Action** that builds an atlas per pull request and attaches it,
      so a reviewer can see the shape of a change rather than only its diff.
- [ ] **Homebrew formula**, for people who would rather not install a global
      npm package.

### Rendering

- [ ] **A WebGL renderer.** No longer deferred. `relayout()` and `reproject()`
      already emit plain world-space geometry that the draw functions consume, so
      this is a swap at one seam rather than a rewrite. Taking on three.js or a
      shader library is a dependency decision, so it gets discussed first.
- [ ] **Nested districts.** The payload already carries `parentId`; the layout
      that would use it does not exist.
- [ ] **Persisted layouts.** Districts can be dragged today, and the arrangement
      dies with the tab.

### Languages

The adapter contract is wide enough that a new language needs no change in
`src/model/`. `docs/adapters.md` carries a worked example and ROADMAP.md has the
detail on each of these.

- [ ] **Go.** Furthest along: a fixture already exists, and a Go import naming a
      package rather than a file is the case the contract was shaped around.
- [ ] **Java and Kotlin.** Wildcard imports are the same shape as a Go package.
- [ ] **Ruby.** Two resolution modes, like Python, so copy that adapter.
- [ ] **Rust.** The hard one, named here so nobody starts with it.

### Not planned

Listed because they get asked for, and a no that is written down is kinder than
one you discover after building something.

Real tracing, OpenTelemetry, or per-hop timings. AST parsing and call-graph
analysis. Editing your code from the map. Search inside the code viewer.
Collections, environments or scripting in the request composer. Multi-repo or
multi-commit diffing.

The first and the third are the load-bearing ones. This tool draws observed
facts and modelled inferences in the same picture, and the only rule holding
that together is that the second never gets to look like the first. A per-hop
number would break it, because nothing here ever watches a request cross an
internal hop. If a request amounts to "like Postman" or "like VS Code", the
answer is no.

## Contributing

The payload `--json` prints is a public contract, documented field by field with
a stability tier in **[docs/payload-schema.md](./docs/payload-schema.md)**.

**[CONTRIBUTING.md](./CONTRIBUTING.md)**. The constraints that are not up for
negotiation are listed there, and the adapters are the documented place to start.

## License

MIT
