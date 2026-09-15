/** What the tool believes about a repository it has never seen: true of code in general, never of one repo, and the floor of the precedence chain. */

/** The columns, left to right by `rank`; layers outside the request spine sit past it rather than inside it.
    No colour here on purpose: `paintLayers()` in src/model/chrome.mjs fills one from the equal-lightness ramp, by position, so the palette steps evenly instead of drifting the way a hand-picked list does. A config that names a colour still keeps it. */
const DEFAULT_LAYERS = [
  { id: "endpoint", label: "ENDPOINT", rank: -1 },
  { id: "entry", label: "ENTRY", rank: 0 },
  // Without a UI column, every component in a frontend repo falls to the fallback.
  { id: "ui", label: "UI", rank: 1 },
  { id: "route", label: "ROUTE", rank: 2 },
  { id: "middleware", label: "MIDDLEWARE", rank: 3 },
  { id: "controller", label: "CONTROLLER", rank: 4 },
  { id: "service", label: "SERVICE", rank: 5 },
  { id: "egress", label: "EGRESS", rank: 6 },
  { id: "repository", label: "REPOSITORY", rank: 7 },
  { id: "datastore", label: "DATASTORE", rank: 8 },
  { id: "contract", label: "CONTRACT", rank: 9 },
  { id: "util", label: "UTIL", rank: 10 },
  { id: "migration", label: "MIGRATION", rank: 11 },
  { id: "tooling", label: "TOOLING", rank: 12 },
  // Its own column, because calling unplaceable code "tooling" is a claim the tool cannot support.
  { id: "unsorted", label: "UNSORTED", rank: 13 },
  { id: "test", label: "TEST", rank: 14 },
  { id: "docs", label: "DOCS", rank: 15 },
];

/** Layers past the request spine: their ranks are layout positions, not spine positions, so anything reasoning about direction skips them. */
export const OFF_SPINE_LAYERS = new Set(["test", "docs", "tooling", "unsorted"]);

/** Layers a request was never meant to reach; distinct from OFF_SPINE_LAYERS, which excludes `migration` and includes `unsorted`. */
export const UNREACHED_LAYERS = new Set(["test", "docs", "tooling", "migration"]);

/** Layer rules for `src/model/classify.mjs`. First match wins, so the order is the design: tests before structure. */
const DEFAULT_LAYER_RULES = [
  { layer: "docs", exts: [".md", ".mdx", ".rst", ".txt"], why: "a documentation file extension" },
  { layer: "migration", exts: [".sql"], why: "a .sql file is schema, not code" },

  // Tests first: a test's directory outranks whatever else it sits under.
  { layer: "test", dirs: ["test", "tests", "spec", "specs", "__tests__", "e2e"], why: "a test directory" },
  { layer: "test", nameRe: /\.(test|spec)\.[cm]?[jt]sx?$/, why: "a .test./.spec. filename" },
  { layer: "test", nameRe: /^test_.*\.py$|_test\.(py|go|rb)$/, why: "a test_/_test filename" },

  // Tooling next, for the same reason: a config file under src/ is still config.
  { layer: "tooling", names: ["conftest.py", "setup.py", "noxfile.py", "Makefile"], why: "a build or test-harness file" },
  { layer: "tooling", nameRe: /\.config\.[cm]?[jt]s$/, why: "a *.config.* file" },
  { layer: "tooling", dirs: ["scripts", "tools", "dev", "devops", "ci", "infra"], why: "a tooling directory" },

  { layer: "migration", dirs: ["migrations", "migration", "alembic", "versions"], why: "a migrations directory" },
  { layer: "route", dirs: ["routes", "routers", "router", "endpoints", "api", "pages"], why: "a routing directory" },
  { layer: "middleware", dirs: ["middleware", "middlewares", "guards", "interceptors"], why: "a middleware directory" },
  { layer: "ui", dirs: ["components", "component", "ui", "views", "screens", "widgets", "layouts", "hooks", "styles"], why: "a user-interface directory" },
  { layer: "controller", dirs: ["controllers", "controller", "handlers", "resolvers"], why: "a controller directory" },
  { layer: "controller", names: ["views.py", "viewsets.py"], why: "the conventional controller filename in this framework" },
  { layer: "service", dirs: ["services", "service", "usecases", "use_cases", "domain", "core", "auth", "logic"], why: "a service directory" },
  { layer: "egress", dirs: ["clients", "client", "integrations", "providers", "adapters", "gateways", "storage", "queue"], why: "an outbound-integration directory" },
  { layer: "repository", dirs: ["repository", "repositories", "repos", "dao", "db", "database", "models", "entities", "cache", "store"], why: "a persistence directory" },
  { layer: "contract", dirs: ["schemas", "schema", "types", "contracts", "dto", "errors", "openapi", "constants", "config"], why: "a shared-contract directory" },
  { layer: "util", dirs: ["utils", "util", "helpers", "shared", "common", "lib"], why: "a shared-utility directory" },

  // Entrypoints last: `index.ts` under routes/ is a route first and an entry second.
  {
    layer: "entry",
    names: [
      "server.ts", "app.ts", "main.ts", "index.ts", "server.js", "app.js", "main.js", "index.js",
      "main.py", "app.py", "server.py", "__init__.py", "__main__.py", "wsgi.py", "asgi.py",
      "main.go", "main.rs", "lib.rs",
    ],
    why: "a conventional entrypoint filename",
  },
  // Still last: a CLI's `bin/` is an entry no filename convention catches, and it must lose to every structural rule.
  { layer: "entry", dirs: ["bin"], why: "the conventional CLI entrypoint directory" },
];

/** Files worth drawing. Wider than the adapters: a language with no adapter still renders structure, sizes and endpoints. */
export const DEFAULT_KEEP = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|php|sql|md)$/;

/** Somebody else's code, vendored into this tree. Split out from the rest because `--include-vendor` lifts exactly these and nothing else — the same list decides what gets drawn and what gets flagged `vendor: true`, so the two can never disagree. */
export const VENDOR_EXCLUDE = [
  /(^|\/)node_modules\//,
  /(^|\/)\.(venv|tox)\//,
  /(^|\/)(venv|env|__pycache__|target|vendor|site-packages)\//,
];

/** Never worth drawing whatever the flags say: build output is this repo's code already drawn once, and a lockfile is not code at all. */
export const HARD_EXCLUDE = [
  /(^|\/)\.git\//,
  // Anchored to the root: a deeper `src/build/` is application code sharing the name.
  /^(dist|build|out|coverage)\//,
  /(^|\/)(public|static)\//,
  /(^|\/)\.(next|nuxt|turbo|svelte-kit|mypy_cache|pytest_cache|ruff_cache)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/,
];

/** Never worth drawing: dependencies, build output, virtualenvs and lockfiles are not code this repository wrote. */
export const DEFAULT_EXCLUDE = [...VENDOR_EXCLUDE, ...HARD_EXCLUDE];

/** Is this path somebody else's code? Read after the walk, so a node can say so even when the walk was told to admit it. */
export const isVendorPath = (p) => VENDOR_EXCLUDE.some((re) => re.test(p));

/** Endpoint rules, as data: the common literal registration forms only, with the receiver required to end in a router-ish word so an outbound `api.get(...)` is not reported as a route. With no `mount`, the prefix comes from the repository's own mount chain. */
const DEFAULT_ENDPOINT_RULES = [
  { re: /\b\w*(?:[Rr]outer|[Aa]pp|[Ss]erver)\s*\.\s*(get|post|patch|put|delete)\s*\(\s*["']([^"']+)["']/g },
  { re: /@\w*(?:[Rr]outer|[Aa]pp)\s*\.\s*(get|post|patch|put|delete)\s*\(\s*["']([^"']+)["']/g },
];

/** The service every repository has before detection finds any: one row, no root, so `makeServiceOf` stays total. */
const DEFAULT_SERVICES = [{ id: "app", label: "APP", lang: "-", root: null, order: 0 }];

/** Findings thresholds: magnitudes, never verdicts. `mute` takes a finding's own `id`, and a muted finding still ships with `muted: true`. */
const DEFAULT_FINDINGS = {
  locThreshold: 400,
  godNodePercentile: 95,
  minGodInDegree: 5,
  orphanRoots: [],
  mute: [],
};

export const DEFAULTS = {
  layers: DEFAULT_LAYERS,
  layerRules: DEFAULT_LAYER_RULES,
  fallbackLayer: "unsorted",
  services: DEFAULT_SERVICES,
  keep: DEFAULT_KEEP,
  exclude: DEFAULT_EXCLUDE,
  endpointRules: DEFAULT_ENDPOINT_RULES,
  findings: DEFAULT_FINDINGS,
};
