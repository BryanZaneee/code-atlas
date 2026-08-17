/**
 * `atlas init` — the starter config.
 *
 * The only thing this repository ever writes into somebody else's, so it writes
 * one file and asks first (the caller refuses to overwrite).
 *
 * What it emits is what detection already found, spelled out: a config exists to
 * override what detection got wrong, and you cannot correct a list you have
 * never seen. Everything else is a commented one-liner pointing at docs/config.md
 * — a starter config full of the defaults restated is a file that drifts out of
 * date the first time the defaults improve.
 *
 * The working tree is read directly rather than through `acquire()`: init writes
 * into the tree you are editing, so that is the tree it should describe, and no
 * rung of the acquisition ladder is involved.
 */
import { DEFAULTS } from "./defaults.mjs";
import { detectServices } from "./detect.mjs";
import { collect } from "../scan/walk.mjs";

/** Enough of a JS literal for the shapes a config holds; not a serializer. */
const lit = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));

const service = (s) =>
  `    { id: ${lit(s.id)}, label: ${lit(s.label)}, lang: ${lit(s.lang)}, root: ${lit(s.root)}, order: ${s.order} },`;

/**
 * @param repo  the working tree to describe
 * @returns the text of an atlas.config.mjs, and what it found
 */
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
