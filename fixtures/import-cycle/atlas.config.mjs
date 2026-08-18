/**
 * Config for the import-cycle fixture — see README.md for what each finding
 * is pinned to. Layers and layerRules are left at the tool's defaults: the
 * fixture's directory names (`routes/`, `repository/`, `services/`,
 * `util/`, `controllers/`... `controller/`) are chosen to land on the
 * default rules on purpose, the same way mini-monorepo pins the no-config
 * path for classification instead.
 */
const services = [
  { id: "app", label: "APP", lang: "ts", root: null, order: 0 },
  { id: "billing", label: "BILLING", lang: "ts", root: "packages/billing", order: 1 },
];

export default {
  services,
  findings: {
    locThreshold: 20,
    godNodePercentile: 50,
    minGodInDegree: 3,
    orphanRoots: [],
    mute: [],
  },
};
