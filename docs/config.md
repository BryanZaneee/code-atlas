# Configuration

**A config is optional.** `atlas build --repo .` detects what it can and falls
back to defaults for the rest, which is the path a repository the tool has never
seen takes. A config exists to override what detection got wrong, and it only
ever overrides the keys it names — **with one exception, `exclude`, which adds
to the defaults rather than replacing them.**

Precedence, lowest to highest:

```
defaults  <  detected  <  config file  <  CLI flags
```

A config is an ESM module with a default export:

```js
// atlas.config.mjs
export default {
  services: [{ id: "api", label: "API", lang: "ts", root: "services/api", order: 0 }],
};
```

Pass it with `--config atlas.config.mjs`. Everything below is optional.

`atlas init --repo .` writes one for you: it detects your services and spells
them out, leaves every other key as a commented one-liner, and **refuses to
overwrite an existing config** — delete it first, or edit it in place. Run
`atlas scan --repo .` afterwards to see what the config did and did not place.

## Structure

| key | type | default | what it does |
| --- | --- | --- | --- |
| `services` | array | detected from manifests | the **rows** of the map |
| `layers` | array | the default taxonomy | the **columns**, ordered by `rank` |
| `layerRules` | array | the default rules | how a file is assigned to a layer |
| `fallbackLayer` | string | `"unsorted"` | where a file no rule matched goes |
| `keep` | RegExp | source, schema and prose extensions | which files are drawn at all |
| `exclude` | RegExp[] | dependencies, build output, lockfiles | which paths are never walked. **Additive** — see below |

### `exclude` is the one additive key

Every other key is a preference a config is entitled to overrule. This one is
hygiene. A config naming a generated-output directory means "also skip this",
never "and walk `node_modules`" — and forgetting to restate the defaults is both
silent and expensive: a worktree scan then walks every dependency ever installed.
Your patterns are appended to the defaults and de-duplicated by source.

### `services`

```js
{ id: "api", label: "API", lang: "ts", root: "services/api", order: 0 }
```

`root` is a repo-relative prefix; the longest matching root wins, so a nested
service beats the one containing it. **A service with `root: null` is the
fallback** and catches everything outside every root. If you declare none,
detection looks for `package.json`, `pyproject.toml`, `setup.py`, `go.mod`,
`Cargo.toml`, `pom.xml` and `Gemfile`, ignoring any inside an excluded path,
and skipping manifest directories that contain no code of their own.

### `layers`

```js
{ id: "service", label: "SERVICE", rank: 5, color: "#8fae74" }
```

`rank` drives the x axis, left to right. It is also what Phase 5 will use to
call an edge a layering violation, so the order is a claim about your
architecture, not just about the picture.

### `layerRules`

Rules are data, matched in order, **first match wins**. A rule matches only if
every primitive it declares matches.

```js
{ layer: "service", dirs: ["services", "usecases"], why: "a service directory" }
```

| primitive | matches when |
| --- | --- |
| `exts` | the path ends with any of these |
| `dirs` | any **directory segment** of the path is one of these |
| `names` | the filename is one of these |
| `nameRe` | the filename matches |
| `re` | the whole path matches |
| `why` | *not* a matcher — the prose INSPECT shows for this rule |

Order is the design. Every test rule comes before every structural one, so a
file under `services/` named `user.test.ts` is a test rather than a service.

A path matching no rule falls back to a directory whose name *is* a layer id,
and failing that to `fallbackLayer` — and says which of those happened. The
share that ended up there is printed after every scan; if it is large, the
defaults are not carrying your layout and this is the key to fix.

### `serviceOf(path)` — the function form

The service analogue of `classify` below. Return a service id for a path, and it
wins over the `services` array's root matching. It is trusted as written,
including its misses — an existing config's payload must not move underneath it.
An id it returns but never declares is **added** to `services` and marked
`synthesized`, rather than its files being dropped.

### `classify(path)` — the older shape

A config may supply a function instead of `layerRules`:

```js
classify: (p) => (/\/routes\//.test(p) ? "route" : "other"),
```

It keeps working and wins over rules. It returns a layer id, or `"other"` for
no match.

Two costs. Provenance: a function can only report *that* the config decided,
never *which* rule matched, so INSPECT is less useful. And its no-match layer is
**`tooling`**, not the `fallbackLayer` default of `unsorted` — that is what this
shape has always meant, and changing it would move existing payloads. Set
`fallbackLayer` to say otherwise. Prefer `layerRules` in new configs.

## Endpoints

| key | type | what it does |
| --- | --- | --- |
| `endpointRules` | array | `{re, mount}` — `re` must capture `(method, path)` |

```js
{ re: /\brouter\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g, mount: "/v1" }
```

`mount` is prefixed unless the literal path already carries it. **A non-literal
path is never matched**: a phantom endpoint is worse than a missing one, so
helper-registered routes are skipped and counted rather than guessed at.

## Tests

| key | type | what it does |
| --- | --- | --- |
| `suiteConfigs` | array | `[path, kind]` pairs — test-runner configs to read |
| `testKind` | function | `(path, suites) => kind`; defaults to `"unit"` |

## Language resolution

| key | type | what it does |
| --- | --- | --- |
| `python.roots` | object | path prefix → the directory on `sys.path` for files under it |
| `python.moduleRoots` | object | leading module name → its root, for a library importable anywhere |
| `python.testDir` | string | the pytest rootdir, so `from conftest import …` resolves |
| `python.internal` | RegExp | modules that **must** exist in-repo; failing to place one is `unresolved`, not "some package we do not scan" |
| `python.barrels` | string[] | `__init__.py` re-export barrels; consumers point at the module that defines the symbol |

## Views

`views` sets the order, titles and hint copy of the view strip. A view is
**data**, and `kind` is what the viewer branches on — never the id:

| kind | what it shows |
| --- | --- |
| `structure` | every node, filtered by the sidebar toggles |
| `flow` | only the nodes and edges named by this view's curated flows |
| `tests` | test edges and the coverage tint |
| `request` | compose a request against one endpoint and play its modelled path |
| `findings` | the whole map, with one finding's evidence lit and the rest dimmed |

The viewer used to hardcode four view ids and branch on two of them by name,
which meant a repo whose flows were called anything else silently lost its flow
views. One flow view is created per distinct `flows[].view`, so curating a flow
adds a view without touching the tool. Supplying a `views` array with matching
ids overrides any of it.

## Theme

`theme` overrides the palette. It is merged **per branch**, so replacing one
edge kind does not drop the other eleven.

| key | type | what it does |
| --- | --- | --- |
| `ink` `bg` | string | text and ground |
| `accent` | string | the **state** channel's one colour — selection, hover, flow membership. Identity writes to fill, state writes to stroke and badge, so turning identity colour off cannot turn the selection off |
| `plate` `edge` | string | the two greys every plate, outline, label halo and watermark is mixed from at an alpha. A named token per opacity would be thirteen tokens per palette |
| `face` | string | the block face in `mono`, where identity fill is off; the two vertical faces are shaded from it |
| `packetLabel` | string | text on a packet |
| `layerFallback` | string | a layer with no `color` |
| `font` | string | a literal font stack — canvas cannot read `var(--mono)` |
| `edgeStyle` `packetColor` `coverTint` | object | per edge kind / packet kind / coverage state |
| `findingSeverity` | object | the ring and evidence-edge colour per finding severity (`error` `warning` `info`) in the findings view. Colour is the second channel there, never the only one — the list chips and the panel spell the severity out |
| `legend` | object | legend rows per view kind; each row *names* a key in the tables above rather than repeating a colour, so the legend cannot drift from the map |
| `dark` | object | the dark theme, as a **delta** over the keys above |
| `density` | object | how much air sits between districts and services. See below |

Canvas cannot read CSS custom properties, so the viewer needs real colour values
in JavaScript. These tables are the single definition: the legend is generated
from them rather than hand-written, which is what stops a legend row and the
thing it labels drifting apart.

### `theme.density`

The map's spacing, as named presets the sidebar offers as a control. `default`
names the one a fresh atlas opens at.

```js
theme: {
  density: {
    default: "normal",
    presets: {
      tight: { spacing: 1.1, gutLayer: 0.4, gutSvc: 0.6 },
    },
  },
}
```

`spacing` is the cell pitch, and the two gutters are the gaps between layer
columns and service rows. The gutters are where most of the air is — start
there. Adding a preset keeps the shipped `compact` / `normal` / `roomy`; naming
one of those replaces it.

**`spacing` is clamped above 1 and cannot be overridden below it.** A block's
footprint is one cell, so a tighter pitch lets footprints overlap, and then the
depth sort and hit testing disagree — the map draws one block and answers with
another. A too-sparse atlas is a preference; that is a bug, so the viewer
corrects the value rather than obeying it.

Only the scalars — and `findingSeverity`, which is drawn over a veiled city and
has to lighten with the ground — appear in `dark`. Everything mixed from them
follows, which is why `edge` inverts to near-white there: in a line-art map the
stroke carries the whole form, and a dark outline on a dark ground is not a
dimmer map, it is no map.

## Findings

| key | type | default | what it does |
| --- | --- | --- | --- |
| `findings.locThreshold` | number | `400` | a file's `loc` past this is an oversized-file candidate |
| `findings.godNodePercentile` | number | `95` | in-degree percentile past which a file is a god node |
| `findings.minGodInDegree` | number | `5` | floor beside the percentile, so a small repo's low p95 does not flag half its files |
| `findings.orphanRoots` | string[] | `[]` | path prefixes excluded from the orphan check, beyond entrypoints |
| `findings.mute` | array | `[]` | `{ id, reason }` — silences one finding by its own `id` |

Overriding `findings` replaces the whole object, the same as every other key
except `exclude` — a config that sets `locThreshold` and wants the other
defaults kept restates them.

`atlas findings --json` prints each finding's `id`; paste it into `mute` with
a reason to silence it. A muted finding still appears in the payload with
`muted: true` — see [payload-schema.md](./payload-schema.md#findings).

```js
findings: {
  locThreshold: 400,
  godNodePercentile: 95,
  minGodInDegree: 5,
  orphanRoots: ["scripts/one-off-migration.ts"],
  mute: [{ id: "orphan:scripts/seed.ts", reason: "run by name from package.json, not imported" }],
},
```

## Curated data

| key | type | what it does |
| --- | --- | --- |
| `flows` | array | curated request flows, rendered as their own views |
| `datastores` | array | nodes for things that are not files |
| `extraEdges` | array | relationships no import expresses |
| `views` | array | order, titles and hint copy for the view strip |

A flow referencing a node that no longer exists is a **warning**; `--strict`
makes it fatal. A stale curated file is not a reason for a generic tool to
refuse to draw your repository.

## Worked examples

`examples/taxvault.config.mjs` — a five-service polyglot monorepo: every value
the prototype hardcoded, in the shape a config takes.
`fixtures/mini-monorepo/atlas.config.mjs` — the small version, where layers come
straight from directory names.
