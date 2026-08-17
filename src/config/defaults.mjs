/**
 * Defaults — what the tool believes about a repository it has never seen.
 *
 * Everything here has to be true of code in general, not of any repository in
 * particular. `test/generic.test.mjs` catches the named strings; the rule that
 * catches the rest is the review question: would this be right on a repo I have
 * never seen? A directory called `services/` means the same thing in a Django
 * project and a Hono one. One repository's particular monorepo layout does not.
 *
 * These are the floor of the precedence chain, so every value here loses to a
 * detected one, which loses to a config file, which loses to a CLI flag.
 */

/**
 * The columns, ordered left to right by `rank`. Router -> controller -> service
 * -> repository is the layering this axis exists to make visible; the layers
 * outside that spine (test, docs, tooling) sit past it rather than inside it.
 */
export const DEFAULT_LAYERS = [
  { id: "endpoint", label: "ENDPOINT", rank: -1, color: "#d8c98a" },
  { id: "entry", label: "ENTRY", rank: 0, color: "#c7b57a" },
  { id: "route", label: "ROUTE", rank: 1, color: "#b9a86a" },
  { id: "middleware", label: "MIDDLEWARE", rank: 2, color: "#b09a72" },
  { id: "controller", label: "CONTROLLER", rank: 3, color: "#a8a86a" },
  { id: "service", label: "SERVICE", rank: 4, color: "#8fae74" },
  { id: "egress", label: "EGRESS", rank: 5, color: "#7fa88c" },
  { id: "repository", label: "REPOSITORY", rank: 6, color: "#7e9a8a" },
  { id: "datastore", label: "DATASTORE", rank: 7, color: "#6a8f9f" },
  { id: "contract", label: "CONTRACT", rank: 8, color: "#8a7e6a" },
  { id: "migration", label: "MIGRATION", rank: 9, color: "#6f7a5e" },
  { id: "tooling", label: "TOOLING", rank: 10, color: "#7d7a63" },
  { id: "test", label: "TEST", rank: 11, color: "#a87e6a" },
  { id: "docs", label: "DOCS", rank: 12, color: "#5f6b52" },
];

/**
 * Layer rules, in `src/model/classify.mjs`'s shape. First match wins, so the
 * order is the whole design: a file under `services/` that is named
 * `user.test.ts` is a test, not a service, which is why every test rule comes
 * before every structural one.
 *
 * A rule matches only if EVERY primitive it declares matches, and each carries
 * a `why` that INSPECT shows verbatim.
 */
export const DEFAULT_LAYER_RULES = [
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
  { layer: "controller", dirs: ["controllers", "controller", "handlers", "resolvers", "views"], why: "a controller directory" },
  { layer: "service", dirs: ["services", "service", "usecases", "use_cases", "domain", "core", "auth", "logic"], why: "a service directory" },
  { layer: "egress", dirs: ["clients", "client", "integrations", "providers", "adapters", "gateways", "storage", "queue"], why: "an outbound-integration directory" },
  { layer: "repository", dirs: ["repository", "repositories", "repos", "dao", "db", "database", "models", "entities", "cache", "store"], why: "a persistence directory" },
  { layer: "contract", dirs: ["schemas", "schema", "types", "contracts", "dto", "errors", "openapi", "constants", "config"], why: "a shared-contract directory" },

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
];

/**
 * Files worth drawing. Source, schema and prose — everything else is an asset,
 * a lockfile or a build product and would only add blocks with no meaning.
 *
 * Wider than the adapters: a language with no adapter yields no import edges but
 * still renders its structure, sizes and endpoints, which is the degradation
 * PLAN.md requires rather than a gap.
 */
export const DEFAULT_KEEP = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|php|sql|md)$/;

/**
 * Never worth drawing anywhere. Dependencies, build output, virtualenvs and
 * lockfiles: none of them is code this repository wrote.
 */
export const DEFAULT_EXCLUDE = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)(dist|build|out|coverage|public|static)\//,
  /(^|\/)\.(next|nuxt|turbo|svelte-kit|venv|tox|mypy_cache|pytest_cache|ruff_cache)\//,
  /(^|\/)(venv|env|__pycache__|target|vendor|site-packages)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/,
];

/**
 * Endpoint rules, as data. These match the common literal registration forms and
 * nothing else — a non-literal path is skipped and counted, never guessed at,
 * because a phantom endpoint is worse than a missing one. Phase 4 replaces the
 * single-pass mount with symbol -> file resolution run to a fixpoint.
 */
export const DEFAULT_ENDPOINT_RULES = [
  { re: /\b(?:app|router|api|server)\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g, mount: "" },
  { re: /@(?:app|router|api)\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g, mount: "" },
];

/**
 * The service every repository has before detection finds any: one row, no root,
 * so `makeServiceOf` is total even here. A single-package repo legitimately ends
 * with exactly this one, and it must render — that is failure mode #1.
 */
export const DEFAULT_SERVICES = [{ id: "app", label: "APP", lang: "-", root: null, order: 0 }];

export const DEFAULTS = {
  layers: DEFAULT_LAYERS,
  layerRules: DEFAULT_LAYER_RULES,
  services: DEFAULT_SERVICES,
  keep: DEFAULT_KEEP,
  exclude: DEFAULT_EXCLUDE,
  endpointRules: DEFAULT_ENDPOINT_RULES,
};
