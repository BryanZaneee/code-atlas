/** What the tool believes about a repository it has never seen: true of code in general, never of one repo, and the floor of the precedence chain. */

/** The columns, left to right by `rank`; layers outside the request spine sit past it rather than inside it. */
const DEFAULT_LAYERS = [
  { id: "endpoint", label: "ENDPOINT", rank: -1, color: "#d8c98a" },
  { id: "entry", label: "ENTRY", rank: 0, color: "#c7b57a" },
  // Without a UI column, every component in a frontend repo falls to the fallback.
  { id: "ui", label: "UI", rank: 1, color: "#c2a98d" },
  { id: "route", label: "ROUTE", rank: 2, color: "#b9a86a" },
  { id: "middleware", label: "MIDDLEWARE", rank: 3, color: "#b09a72" },
  { id: "controller", label: "CONTROLLER", rank: 4, color: "#a8a86a" },
  { id: "service", label: "SERVICE", rank: 5, color: "#8fae74" },
  { id: "egress", label: "EGRESS", rank: 6, color: "#7fa88c" },
  { id: "repository", label: "REPOSITORY", rank: 7, color: "#7e9a8a" },
  { id: "datastore", label: "DATASTORE", rank: 8, color: "#6a8f9f" },
  { id: "contract", label: "CONTRACT", rank: 9, color: "#8a7e6a" },
  { id: "util", label: "UTIL", rank: 10, color: "#8c8a76" },
  { id: "migration", label: "MIGRATION", rank: 11, color: "#6f7a5e" },
  { id: "tooling", label: "TOOLING", rank: 12, color: "#7d7a63" },
  // Its own column, because calling unplaceable code "tooling" is a claim the tool cannot support.
  { id: "unsorted", label: "UNSORTED", rank: 13, color: "#6e6a5e" },
  { id: "test", label: "TEST", rank: 14, color: "#a87e6a" },
  { id: "docs", label: "DOCS", rank: 15, color: "#5f6b52" },
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

/** Never worth drawing: dependencies, build output, virtualenvs and lockfiles are not code this repository wrote. */
export const DEFAULT_EXCLUDE = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  // Anchored to the root: a deeper `src/build/` is application code sharing the name.
  /^(dist|build|out|coverage)\//,
  /(^|\/)(public|static)\//,
  /(^|\/)\.(next|nuxt|turbo|svelte-kit|venv|tox|mypy_cache|pytest_cache|ruff_cache)\//,
  /(^|\/)(venv|env|__pycache__|target|vendor|site-packages)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/,
];

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
