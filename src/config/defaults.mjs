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
  // A client-side repo has a whole spine the backend taxonomy has no column for.
  // Without this one, every component in a frontend project falls to the
  // fallback and the map is one tall column of "tooling" — legible only in the
  // sense that it did not crash.
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
  // Where a file goes when no rule recognised it. It has to be its own column:
  // calling unplaceable application code "tooling" is a claim the tool cannot
  // support, and it hides how much of the repo the rules actually understood.
  { id: "unsorted", label: "UNSORTED", rank: 13, color: "#6e6a5e" },
  { id: "test", label: "TEST", rank: 14, color: "#a87e6a" },
  { id: "docs", label: "DOCS", rank: 15, color: "#5f6b52" },
];

/**
 * The layers that sit PAST the request spine rather than on it.
 *
 * Their ranks order them in the layout — they have to go somewhere, and after
 * everything else is the honest place — but a rank is not a position on the
 * spine, and comparing one to a real layer's is a category error. `unsorted`
 * is the case that bites: it ranks above every real layer, so treating its rank
 * as meaningful makes every unclassified file's import look like it runs
 * backwards. "No rule matched" is an absence of knowledge, not a high rank.
 *
 * PLAN.md ("The visual system") puts it as: the layers outside the spine sit
 * past it rather than inside it. Anything reasoning about direction along the
 * spine — path derivation, layering findings — has to skip them, and has to
 * skip the same ones, which is why this lives here and not in either.
 */
export const OFF_SPINE_LAYERS = new Set(["test", "docs", "tooling", "unsorted"]);

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
 * because a phantom endpoint is worse than a missing one. The prefix a rule
 * doesn't declare a `mount` for comes from `resolveMounts`'s fixpoint
 * (src/model/mounts.mjs); a call a rule's receiver/method shape recognises but
 * whose path isn't a literal is counted too, not silently dropped — both live
 * in src/model/endpoints.mjs.
 */
// No `mount`: the prefix is discovered from the repository's own mount chain.
// A rule that states one is a claim by a config, and that always wins — see
// src/model/endpoints.mjs.
// The receiver must END in a router-ish word, so `photosRouter.post(...)` and
// `router.post(...)` both match. Deliberately not any identifier at all, and
// deliberately not a bare `api`: `api.get("/photos")` in client code is a call
// *to* an endpoint, and reporting it as one would invent a route this
// repository does not serve.
export const DEFAULT_ENDPOINT_RULES = [
  { re: /\b\w*(?:[Rr]outer|[Aa]pp|[Ss]erver)\s*\.\s*(get|post|patch|put|delete)\s*\(\s*["']([^"']+)["']/g },
  { re: /@\w*(?:[Rr]outer|[Aa]pp)\s*\.\s*(get|post|patch|put|delete)\s*\(\s*["']([^"']+)["']/g },
];

/**
 * The service every repository has before detection finds any: one row, no root,
 * so `makeServiceOf` is total even here. A single-package repo legitimately ends
 * with exactly this one, and it must render — that is failure mode #1.
 */
export const DEFAULT_SERVICES = [{ id: "app", label: "APP", lang: "-", root: null, order: 0 }];

/**
 * Findings thresholds (`src/model/findings.mjs`, Phase 5). Every value here is
 * a magnitude, never a verdict about a particular repository — a
 * `locThreshold` of 400 says "worth a second look past this many lines," not
 * "this file is bad."
 *
 * `mute` is empty by default. A finding's own `id`, printed by
 * `atlas findings --json`, is what a config pastes back in here to mute it —
 * the finding still appears in the payload with `muted: true`, so muting never
 * makes the map quietly incomplete.
 */
export const DEFAULT_FINDINGS = {
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
