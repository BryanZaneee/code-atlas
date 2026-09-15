/**
 * TaxVault taxonomy — the prototype's hardcoded knowledge, frozen verbatim.
 *
 * Every value here was a literal inside the prototype's scanner. Nothing about
 * it improved during Phase 0; only its location changed, which is what lets the
 * payload be proved unchanged. `test/generic.test.mjs` is the fence: none of
 * this may leak back into src/ or bin/.
 *
 * Phases 2-4 make most of it unnecessary by detecting it instead. Until then
 * this file doubles as the worked example of what a config looks like.
 */
import { FLOWS, DATASTORES, EXTRA_EDGES } from "./taxvault.flows.mjs";

const services = [
  { id: "core-api",  label: "CORE CASE API",      lang: "ts", root: "apps/api",              order: 0 },
  { id: "ingestion", label: "INGESTION / OCR",    lang: "py", root: "ingestion-ocr-service", order: 1 },
  { id: "shared-py", label: "SHARED PYTHON LIB",  lang: "py", root: "shared-python",         order: 2 },
  { id: "identity",  label: "IDENTITY / AUTH",    lang: "py", root: "identity-auth-service", order: 3 },
  { id: "core-case", label: "CORE CASE (LEGACY)", lang: "ts", root: "core-case-service",     order: 4 },
  { id: "infra",     label: "DATASTORES",         lang: "-",  root: null,                    order: 5 },
  { id: "docs",      label: "DOCS",               lang: "md", root: "docs",                  order: 6 },
];

// rank drives the x axis. AGENTS.md rule 10 (router -> controller -> service ->
// repository) is what this ordering is built to make visible.
const layers = [
  { id: "endpoint",   label: "ENDPOINT",   rank: -1, color: "#d8c98a" },
  { id: "entry",      label: "ENTRY",      rank: 0,  color: "#c7b57a" },
  { id: "route",      label: "ROUTE",      rank: 1,  color: "#b9a86a" },
  { id: "middleware", label: "MIDDLEWARE", rank: 2,  color: "#b09a72" },
  { id: "controller", label: "CONTROLLER", rank: 3,  color: "#a8a86a" },
  { id: "service",    label: "SERVICE",    rank: 4,  color: "#8fae74" },
  { id: "egress",     label: "EGRESS",     rank: 5,  color: "#7fa88c" },
  { id: "repository", label: "REPOSITORY", rank: 6,  color: "#7e9a8a" },
  { id: "datastore",  label: "DATASTORE",  rank: 7,  color: "#6a8f9f" },
  { id: "contract",   label: "CONTRACT",   rank: 8,  color: "#8a7e6a" },
  { id: "migration",  label: "MIGRATION",  rank: 9,  color: "#6f7a5e" },
  { id: "tooling",    label: "TOOLING",    rank: 10, color: "#7d7a63" },
  { id: "test",       label: "TEST",       rank: 11, color: "#a87e6a" },
  { id: "docs",       label: "DOCS",       rank: 12, color: "#5f6b52" },
];

// Files whose role their directory does not reveal (shared lib + legacy domain).
const NAME_CONTRACT = new Set(["roles.py", "redaction.py", "models.py", "stage.ts"]);
const NAME_SERVICE = new Set([
  "verifier.py", "context.py", "security.py",
  "stage-engine.ts", "engagement.ts", "example-handler.ts",
]);

const exclude = [
  /^apps\/api\/drizzle\/meta\//,     // generated snapshots: 6k lines of noise
  /^apps\/api\/db\/migrations\//,    // dead legacy, superseded by drizzle/
  /^prompt-journal\//,               // no import edges; would render as a blob
  /^fixtures\//,
  /^\.github\//,
  /^\.codex\//,
  /(^|\/)package-lock\.json$/,
  /(^|\/)uv\.lock$/,
];

// JSON only inside a source tree: apps/api imports the Python lib's
// redaction-policy.json so both languages redact the same field names.
const keep = /\.(ts|py|sql|md)$|(^|\/)(src|app)\/.*\.json$/;

function classify(p) {
  const name = p.split("/").pop();
  if (/\.sql$/.test(p)) return "migration";
  if (/\.md$/.test(p)) return "docs";
  if (/(^|\/)tests?\//.test(p)) return "test";
  if (name === "conftest.py" || /\.config\.(ts|js|mjs)$/.test(name) || /(^|\/)dev\//.test(p)) return "tooling";
  if (/(^|\/)(routes|routers)\//.test(p)) return "route";
  if (/(^|\/)middleware\//.test(p)) return "middleware";
  if (/(^|\/)controllers\//.test(p)) return "controller";
  if (/(^|\/)(services|auth)\//.test(p)) return "service";
  if (/(^|\/)(ingestion|storage)\//.test(p)) return "egress";
  if (/(^|\/)(repository|db|cache)\//.test(p)) return "repository";
  if (/(^|\/)(schemas|errors|openapi|security)\//.test(p)) return "contract";
  if (NAME_CONTRACT.has(name)) return "contract";
  if (NAME_SERVICE.has(name)) return "service";
  if (/^(server|app|main|index|__init__)\.(ts|py)$/.test(name)) return "entry";
  return "other";
}

const serviceOf = (p) => services.find((s) => s.root && p.startsWith(s.root + "/"))?.id ?? "other";

export default {
  services,
  layers,
  exclude,
  keep,
  classify,
  serviceOf,

  // Python module resolution. `roots` maps a path prefix to the directory that
  // sits on sys.path for files under it; `moduleRoots` does the same keyed by
  // the leading module name, for a library importable from anywhere.
  python: {
    roots: {
      "ingestion-ocr-service": "ingestion-ocr-service",
      "identity-auth-service": "identity-auth-service",
      "shared-python": "shared-python/src",
    },
    moduleRoots: { tax_vault_shared: "shared-python/src" },
    // pytest inserts the rootdir on sys.path, so `from conftest import ...`
    // resolves against the service's own test directory.
    testDir: "test",
    // Modules that must exist in-repo: failing to place one is "unresolved",
    // not "some package we do not scan".
    internal: /^(app|tax_vault_shared)\b/,
    // A re-export barrel: consumers of `from tax_vault_shared import X` point at
    // the module that defines X rather than collapsing onto the barrel.
    barrels: ["shared-python/src/tax_vault_shared/__init__.py"],
  },

  // Both services mount their routers at /v1 and hang unversioned probes
  // straight off the app, so the prefix follows the call form, not the service.
  endpointRules: [
    { re: /\brouter\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g, mount: "/v1" },
    { re: /@app\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g, mount: "" },
  ],

  // Read the vitest configs so unit/integration/pact stays correct if they change.
  suiteConfigs: [
    ["apps/api/vitest.integration.config.ts", "integration"],
    ["apps/api/vitest.pact.config.ts", "pact"],
    ["apps/api/vitest.config.ts", "unit"],
  ],

  testKind(p, suites) {
    if (p.startsWith("apps/api/")) {
      const rel = p.slice("apps/api/".length);
      for (const s of suites) {
        if (s.include.some((re) => re.test(rel)) && !s.exclude.some((re) => re.test(rel))) return s.kind;
      }
      return "unit";
    }
    if (/\/test\/pact\//.test(p)) return "pact";
    if (/\/test\/e2e\//.test(p)) return "e2e";
    if (/\/test\/migrations\//.test(p)) return "integration";
    return "unit";
  },

  // Order and copy for the view strip. `kind` and `showPhase` are derived from
  // the flows, so they are deliberately absent here. This is where the prose
  // that used to be hardcoded in the viewer belongs — it describes THIS
  // repository, and nothing in src/ should know any of it.
  views: [
    {
      id: "structure",
      label: "STRUCTURE",
      title: "THE CODEBASE",
      hint: "Rows are services, columns are the router → controller → service → repository layers AGENTS.md rule 10 mandates. Block height is file length. Click a district to open it and list its files.",
    },
    {
      id: "api",
      label: "API FLOW",
      title: "API CALL FLOW",
      hint: "Each entry is one endpoint's real call chain. Packets carry a synthetic payload — click one to read the note attached to that hop.",
    },
    {
      id: "engagement",
      label: "ENGAGEMENT",
      title: "ENGAGEMENT DOCUMENT FLOW",
      hint: "The cross-service document trace, in three phases. STEP walks it one hop at a time. The dashed red edges are the two places the OCR service touches Core's tables directly instead of calling its API.",
    },
    {
      id: "tests",
      label: "TESTS",
      title: "TEST COVERAGE FLOW",
      hint: "Thick edges are a test's primary subject, thin dashed ones are everything else it exercises. Orange blocks have no test referencing them.",
    },
  ],

  flows: FLOWS,
  datastores: DATASTORES,
  extraEdges: EXTRA_EDGES,
};
