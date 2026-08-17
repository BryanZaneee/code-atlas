/**
 * Config for the mini-monorepo fixture — the CI-enforced target.
 *
 * Deliberately a second worked example alongside examples/taxvault.config.mjs,
 * and deliberately unlike it: layers come straight from directory names here,
 * which is the shape Phase 2's directory-derived fallback has to produce
 * automatically for a repo with no config at all.
 */
const services = [
  { id: "api",    label: "API",    lang: "ts", root: "services/api",    order: 0 },
  { id: "worker", label: "WORKER", lang: "py", root: "services/worker", order: 1 },
  { id: "docs",   label: "DOCS",   lang: "md", root: "docs",            order: 2 },
];

const layers = [
  { id: "endpoint",   label: "ENDPOINT",   rank: -1, color: "#d8c98a" },
  { id: "entry",      label: "ENTRY",      rank: 0,  color: "#c7b57a" },
  { id: "route",      label: "ROUTE",      rank: 1,  color: "#b9a86a" },
  { id: "service",    label: "SERVICE",    rank: 2,  color: "#8fae74" },
  { id: "repository", label: "REPOSITORY", rank: 3,  color: "#7e9a8a" },
  { id: "tooling",    label: "TOOLING",    rank: 4,  color: "#7d7a63" },
  { id: "test",       label: "TEST",       rank: 5,  color: "#a87e6a" },
  { id: "docs",       label: "DOCS",       rank: 6,  color: "#5f6b52" },
];

function classify(p) {
  const name = p.split("/").pop();
  if (/\.md$/.test(p)) return "docs";
  if (/(^|\/)tests?\//.test(p)) return "test";
  if (/(^|\/)routes\//.test(p)) return "route";
  if (/(^|\/)services\/[^/]+\.(ts|py)$/.test(p)) return "service";
  if (/(^|\/)repository\//.test(p)) return "repository";
  if (/^(server|app|main|index|__init__)\.(ts|py)$/.test(name)) return "entry";
  return "other";
}

export default {
  services,
  layers,
  keep: /\.(ts|py|md)$/,
  exclude: [],
  classify,
  serviceOf: (p) => services.find((s) => s.root && p.startsWith(s.root + "/"))?.id ?? "other",

  python: {
    roots: { "services/worker": "services/worker" },
    testDir: "test",
    internal: /^app\b/,
  },

  endpointRules: [
    { re: /\brouter\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g, mount: "/api" },
    { re: /@app\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g, mount: "" },
  ],

  suiteConfigs: [],
  testKind: () => "unit",
};
