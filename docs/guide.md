# Project guide

[Back to the README](../README.md).

## Why

Code Atlas maps files, imports, inferred request paths, and test reach so you can inspect how a repository is organized.

## Commands

```
atlas build     # -> a single self-contained HTML atlas
atlas scan      # what the scanner found, and what it couldn't
atlas init      # write a starter config by inspecting the repo
atlas serve     # local viewer on 127.0.0.1, with read-only source reading
atlas findings  # cycles, layering violations, orphans, untested endpoints
atlas map       # draw the atlas in this terminal
```

Common flags: `--repo PATH` (default `.`), `--config FILE` (optional, atlas
detects otherwise), `--ref REF` (git ref, or `worktree` / `fs`; default `HEAD`),
`--json` (print the payload instead of writing HTML). `serve` also takes
`--port` (default `4173`) and `--open`; `map` takes `--width`, `--height` and
`--color`. Full list: `node bin/atlas.mjs --help`.

One runnable line each, from a repository root:

```bash
atlas build --out docs/atlas.html   # one self-contained file to send someone
atlas scan                          # file counts per layer, and what it skipped
atlas init                          # writes atlas.config.mjs; refuses to overwrite
atlas findings --json               # the same graph problems, machine-readable
```

### `atlas map`

The terminal map uses half-block characters for two vertical pixels per cell. Blocks draw from back to front using the same layer colors as the browser viewer.

```
atlas map                       # fits the window you are in
atlas map --width 100 --height 30
atlas map --color none          # or NO_COLOR=1
atlas map | less -R             # a pipe is never sent escapes at all
```

Terminal colors adapt to `COLORTERM`, `TERM`, `NO_COLOR`, and whether stdout is a terminal. If files do not fit, the map groups them into district blocks and labels that mode in the header. The terminal view shows files, line counts, and layers; it does not show inferred paths.

## Features

**Views.** STRUCTURE shows files and imports. TESTS shows test reach. API REQUEST models paths through endpoints. FINDINGS highlights eight structural checks. Inferred paths are labeled on the canvas, in the panel, and at each hop. Configured flows add their own views.

**The map.** Services are rows; columns group files by folder or layer. Color identifies the layer, and file length controls height and footprint. Controls include pan, zoom, rotation, search, service filters, packet playback, and draggable blocks and districts. Click a block to see the placement rule.

**Appearance and notes.** Choose from four palettes or set layer colors individually. COPY CONFIG exports the theme. Browser storage holds file notes. Blocks support custom colors, shapes, and sizes; districts can collapse into single blocks.

**Reading the code.** `atlas serve` adds a SOURCE tab that opens the file behind
a block at the line that matters: an endpoint's registration, an import, a test's
subject. `atlas build --embed-source` bakes the text into the HTML instead, so a
single file can travel without the repository.

**Composing a request.** Select an endpoint and enter parameters, query values, headers, and a body. Playback shows a modeled path without sending a request. Solid hops have supporting imports; dotted hops do not. CURATE THIS exports the path as a config entry for review.

## Reading the map

**Position.** Services are rows. Columns group files by folder or layer, depending on the sidebar setting. Click a block to see the rule used to place it.

**Height.** File blocks use `log1p(loc)`, normalized against the repository’s 95th percentile. Heights can be compared within one map, but not across repositories. Endpoints and datastores have fixed heights.

**Color.** Fill identifies the layer. The `▦ MONO` toggle hides layer colors while preserving test-reach shading, selection rings, and finding highlights.

**Grid and edges.** Each service has a labeled plate. Each service-and-layer cell is a district with a two-character code. Static lines show imports. Moving packets follow imports or play a selected request path in order.

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
| `⌘K` / `Ctrl-K` | go to a file, district, endpoint or finding by name |
| `←` `→` | step one hop while a path is playing |
| `↑` `↓` `←` `→` | otherwise, move the selection to the next block that way |
| `[` `]` | previous / next view |
| `Enter` | open the selected block's source |
| `Alt-←` `Alt-→` | back and forward through where you have been |
| `Esc` | close the palette, else the reader, else clear the selection, packet, finding or armed request |
| click | inspect a block, a district, or a moving packet |
| hover a source line | a `→` appears where an import resolved; click it to follow |

All controls support keyboard navigation. Use `⌘K`, type a name, and press `Enter`. Jumping to a hidden block restores its service, expands its district, and clears any filter hiding it.

The viewer is read-only. The command palette searches names, not source text. See PLAN.md under "Decisions reversed" for the rationale.

## The views

**STRUCTURE** shows the repository. **TESTS** uses orange for files no test reaches, a muted tint for indirect reach, and normal color for direct references. **FINDINGS** highlights the relevant blocks and edges without changing their positions.

**API REQUEST** isolates the selected path in its own districts. Labels distinguish curated paths from paths inferred through imports. Neither is an observed execution trace.

**Flow views** appear one per distinct `flows[].view` in your config, for paths
you have curated by hand.

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

Thresholds are configurable review prompts. Muting a finding by ID preserves it in the payload as `muted` and displays it dashed.

## How to tell what the tool knows from what it guessed

The badges distinguish source analysis, configured paths, inferred paths, and live HTTP results.

**The canvas badge, top right.** `CURATED · MODELLED PATH` means the ordering was configured by a person. `DERIVED · NOT VERIFIED` means it was inferred from imports. `LIVE · STATUS OBSERVED · PATH STILL MODELLED` means the HTTP result was observed, but the internal path remains inferred.

**Solid and dotted hops.** Solid hops have a supporting import and a link to its source line. Dotted hops have no supporting import and no source link.

**`PACKET PAYLOAD (SYNTHETIC)`.** Per-hop payloads are illustrative, including in LIVE mode. The tool does not observe data passing through internal hops.

**No per-hop timings.** The tool does not trace internal execution, so it cannot report hop durations.

**Authorization.** With `--auth-env`, the server injects the token and the browser sees only the environment variable name. Otherwise, typed tokens stay in the tab’s `sessionStorage` and can be cleared. Saved composer fields preserve the header name with an empty value.

**The footer badge** says where source comes from: served live, embedded in this
file, or not available.

## Composing a request

Pick an endpoint in the REQUEST view, fill in its path parameters, query, headers
and body, and press `SEND (MODELED)`. Nothing is sent: the map plays the path the
request *would* take, curated first and derived otherwise, with each hop marked
by whether an import backs it.

**CURATE THIS** exports the displayed path as a config entry. Review it, then add it to `flows`.

### Live mode

Off unless you ask for it, and it needs the server:

```bash
atlas serve --repo . --allow-live --target http://127.0.0.1:3000
atlas serve --repo . --allow-live --target http://127.0.0.1:3000 --auth-env AUTH_TOKEN
```

The button becomes `SEND (LIVE)`. The endpoint displays the HTTP status and round-trip time. Non-2xx responses stop playback at the first hop. Repeated sends record count, minimum, median, and p95; p95 appears after at least five samples.

The proxy accepts `{method, path, headers, body}`. Its destination is fixed by
the command-line target; the browser cannot supply a host or URL. Targets must be loopback or private addresses, names are never
resolved, redirects are reported and never followed, and **no response body is
ever returned to the page**: you get a status, a duration and a byte count.

## When the map looks wrong

**Run `atlas scan` first.** It prints what the scanner found and what it could
not: unresolved imports, files it has no adapter for, endpoint registrations it
skipped, and how many files fell through to the fallback layer.

**Inspect the misplaced block.** Its panel shows the placement rule. Adjust the config if that rule does not match the file’s role.

| what you see | usually means |
| --- | --- |
| everything in one service | no manifests to detect. Run `atlas init` and edit the `services` it writes |
| a high `unsorted` count | your directory names do not match the default rules. Add `layerRules` |
| no endpoints | routes registered through a helper, or a framework the default rules do not match. `atlas scan` counts what it skipped; add an `endpointRules` entry |
| almost no import edges | a language with no adapter. `scan` reports those files; the map still shows structure |
| a file you just wrote is missing | `--ref` defaults to `HEAD`. Pass `--ref worktree` (or `fs`) to include uncommitted work |
| too dense to read | `theme.density`, the service toggles, or map a subdirectory with `--repo` |
| nothing to play | no curated flows and derivation found no path. The composer says so per endpoint |

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
| Runtime | Node ≥ 20, ESM `.mjs` | native ESM support |
| Build | none | source runs directly in Node |
| Viewer | vanilla JS, Canvas 2D, CSS custom properties | no framework and no external fetch, so a built atlas works over `file://` |
| Parsing | regex, not AST | see Limitations. The cost is under-reporting, and it is measured |
| Highlighting | Prism 1.29.0, vendored | a real highlighter without an install step or a bundler |
| Tests | `node:test` | in the runtime already |

The core has no npm runtime dependencies. The viewer bundles its assets so generated HTML works offline. Prism is vendored for syntax highlighting.

## Stretch goals

Checked items are implemented. Unchecked items are proposals. Excluded features are listed under **Not planned**.

### Editor and IDE integration

The SOURCE panel opens a file at the selected endpoint or import. `⌘K` searches files, districts, endpoints, and findings; arrow keys move the selection. Resolved imports link to their source.

The viewer is read-only. `atlas init` is the only command that writes into the mapped repository. Proposed editor integrations would open files in an external editor.

- [ ] **Open in your editor.** A control on every block and endpoint that fires
      `vscode://file/<path>:<line>`, with equivalents for Cursor, Zed and the
      JetBrains family. Atlas stays read-only and your editor does the editing.

- [ ] **A VS Code extension** that hosts the viewer as a panel, so the map sits
      beside the code instead of in a browser tab. A separate package, the way
      `desktop/` already is: its dependency stays out of the core, which remains
      a CLI that writes one file and installs nothing.
- [ ] **Watch mode.** `atlas serve --watch` rebuilds as files change, so the map
      keeps up with a refactor instead of going stale behind it.
- [ ] **Deep links into the map.** A URL that opens an atlas already focused on a
      district, a node or a finding, so a map can be cited in a review.

### Distribution

- [x] `atlas` with no arguments maps the repository you are standing in, reads
      the working tree rather than HEAD, and opens the result.
- [x] Offers to write a starter config when most files match no layer rule.
- [x] **A desktop shell**, in `desktop/`. The Electron main process runs the same
      loopback server `atlas serve` runs, and points a window at it. Its
      dependency lives in its own `package.json`, so the core still installs
      nothing.
- [ ] **Publish to npm** as `code-atlas`. The package is ready; publishing needs
      an account with rights to the name.
- [ ] **Ship the desktop app**: code signing, notarization, auto-update and a
      release pipeline. The window runs today; none of the packaging around it
      exists.
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

- [x] **Go.** An import names a package, which is a directory, so one specifier
      resolves to every `.go` file in it.
- [x] **Java and Kotlin.** One adapter: a Kotlin file routinely imports a Java
      one out of the same source root. Wildcards are the Go-package shape again.
- [x] **Ruby.** `require_relative` against the file, `require` against a load
      path that is inferred rather than read.
- [x] **Rust.** The module tree resolves; `pub use` re-export chains do not, and
      the conformance table records that rather than leaving it to be found.
- [ ] PHP, C#, the two most asked for next.

Files in unsupported languages still appear with their sizes and classifications. `atlas scan` reports how many lack import analysis.

**Adapters resolve imports.** Endpoint detection uses JavaScript route patterns. Go and Rails repositories generally need custom `endpointRules` to show endpoints.

### Not planned

These features are outside the project scope:

Real tracing, OpenTelemetry, or per-hop timings. AST parsing and call-graph
analysis. Editing your code from the map. Search inside the code viewer.
Collections, environments or scripting in the request composer. Multi-repo or
multi-commit diffing.

Live mode reports an HTTP response without tracing internal execution. The viewer remains read-only.

## What is real and what is modeled

The viewer labels observed HTTP results separately from modeled internal paths.

| Shown | Status |
| --- | --- |
| Files, sizes, directories | **Observed**, read from disk |
| Import edges | **Observed**, parsed from source (regex; under-reports) |
| Endpoints and mount prefixes | **Observed**, statically resolved through the router graph |
| HTTP response, status, latency | **Observed**, in LIVE mode, HTTP result from a sent request. Off unless you pass `--allow-live` |
| **The internal path a request takes** | **MODELED**, inferred from imports. Never observed. Calibrated at 17% precision / 12% recall against nine hand-curated flows |
| Per-hop timing | Not measured or displayed. |

### Path derivation, calibrated

Derived paths are inferred from the import graph. The measurements below compare them with manually curated flows.

Measured against TaxVault at commit `22595f3a`, across its 9 hand-curated
flows (93 hops a human traced by reading the code): **precision 17%, recall
12%** (tp=11, 52 invented, 81 missed, 1 mis-ordered). Concretely: of the 93
hops curation says are real, derivation found 11; the other 53 hops it output
were either invented (52 edges absent from the curated
request path) or right but in the wrong order (1). It missed 81 hops outright.

The TaxVault result covers one repository and nine flows. Treat it as a limited calibration sample. In repositories without curated flows, derived paths remain unverified.

A second measurement uses [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) at commit `cb740b6`: 5 curated flows, 44 hops, **23% precision and 16% recall** (tp=7, 23 invented, 37 missed, 0 mis-ordered). TaxVault uses dependency injection; the FastAPI template uses module-level imports. Derivation still misses the ASGI chain and follows package-barrel imports rather than the actual execution path.

Run `npm run calibrate`, or `node test/calibrate.mjs fastapi-template` for the
second corpus. CI requires at least 15% precision and 10% recall.

## Limitations

**Imports are read with regexes, not a parser.** Dynamic imports, unusual
formatting and computed specifiers are missed. Under-reporting is the accepted
cost, and `atlas scan` prints what it could not resolve rather than hiding it.

**Non-literal route paths are skipped.** `atlas scan` counts registrations it
cannot resolve, including routes registered through unsupported helpers.

**Request paths are modeled.** TaxVault calibration measured 17% precision and 12% recall across nine curated flows. The FastAPI measurement is listed above.

**Six adapters: TypeScript/JavaScript, Python, Go, Ruby, Java/Kotlin and Rust.**
Other languages appear with file sizes, layers, and any matching endpoint rules,
but no import edges. `atlas scan` reports unsupported files. See the
[adapter guide](adapters.md) to add a language.

**Endpoint detection uses JavaScript route patterns.** Go, Rails, and Spring projects usually need custom `endpointRules`, even when their imports are supported.

**Rust does not follow `pub use` re-export chains.** An import of a type
re-exported through `lib.rs` lands on the file that exports the name rather than
the file that defines the type, one hop short. It is recorded in the
conformance table, not hidden.

**No call graph or per-hop timings.** Live mode sends an HTTP request and reports the response status, duration, and size. It does not trace execution inside the application.

**Live targets must use loopback or private IP addresses.** Hostnames are not
resolved. Use `127.0.0.1:3000`, for example, rather than `myapp.local`.
