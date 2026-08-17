# Configuration

**A config is optional.** `atlas build --repo .` detects what it can and falls
back to defaults for the rest, which is the path a repository the tool has never
seen takes. A config exists to override what detection got wrong, and it only
ever overrides the keys it names.

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

## Structure

| key | type | default | what it does |
| --- | --- | --- | --- |
| `services` | array | detected from manifests | the **rows** of the map |
| `layers` | array | the default taxonomy | the **columns**, ordered by `rank` |
| `layerRules` | array | the default rules | how a file is assigned to a layer |
| `fallbackLayer` | string | `"unsorted"` | where a file no rule matched goes |
| `keep` | RegExp | source, schema and prose extensions | which files are drawn at all |
| `exclude` | RegExp[] | dependencies, build output, lockfiles | which paths are never walked |

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

### `classify(path)` — the older shape

A config may supply a function instead of `layerRules`:

```js
classify: (p) => (/\/routes\//.test(p) ? "route" : "other"),
```

It keeps working and wins over rules. It returns a layer id, or `"other"` for
no match. The cost is provenance: a function can only report *that* the config
decided, never *which* rule matched, so INSPECT is less useful. Prefer
`layerRules` in new configs.

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
