/** `atlas init`: a starter config spelling out what detection found, read from the working tree it describes. */
import { DEFAULTS } from "./defaults.mjs";
import { detectServices } from "./detect.mjs";
import { collect } from "../scan/walk.mjs";

/** Enough of a JS literal for the shapes a config holds; not a serializer. */
const lit = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));

const service = (s) =>
  `    { id: ${lit(s.id)}, label: ${lit(s.label)}, lang: ${lit(s.lang)}, root: ${lit(s.root)}, order: ${s.order} },`;

export function starterConfig(repo) {
  const { all, paths } = collect(repo, { keep: DEFAULTS.keep, exclude: DEFAULTS.exclude });
  const services = detectServices({ dir: repo, all, paths, exclude: DEFAULTS.exclude }) ?? DEFAULTS.services;

  const text = `/**
 * atlas config — written by \`atlas init\`, edit freely.
 *
 * Every key is optional and overrides only what it names; anything absent keeps
 * the detected or default value. Full reference: docs/config.md.
 */
export default {
  // The rows of the map, detected from package manifests. Relabel and reorder
  // to taste — \`root\` is a repo-relative prefix, the longest match wins, and a
  // service with \`root: null\` catches everything no other root claims.
  services: [
${services.map(service).join("\n")}
  ],

  // The columns, ordered by rank. Uncomment to name your own; \`rank\` is a claim
  // about your architecture, since phase 5 reads it to call an edge a layering
  // violation.
  // layers: [{ id: "service", label: "SERVICE", rank: 4, color: "#8fae74" }],

  // How a file finds its column. Rules are data, matched in order, first match
  // wins, and each carries the prose INSPECT shows for it. Run \`atlas scan\` to
  // see how many files no rule matched.
  // layerRules: [{ layer: "service", dirs: ["services"], why: "a service directory" }],

  // \`re\` must capture (method, path); \`mount\` is prefixed unless the literal
  // path already carries it. A non-literal path is never matched.
  // endpointRules: [{ re: /\\brouter\\.(get|post|patch|put|delete)\\(\\s*["']([^"']+)["']/g, mount: "/v1" }],

  // What is drawn at all, and what is never walked into.
  // keep: /\\.(ts|py|sql|md)$/,
  // exclude: [/^generated\\//],
};
`;
  return { text, services, fileCount: paths.length };
}
