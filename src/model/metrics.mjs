/** Coverage from the import graph, not a coverage tool: direct / indirect / none, and null when there is nothing to measure. */
import { UNREACHED_LAYERS } from "../config/defaults.mjs";
import { adjacency, reachableFrom } from "./graph.mjs";

export function deriveCoverage(nodes, edges) {
  const direct = new Set(edges.filter((e) => e.kind.startsWith("test:")).map((e) => e.to));

  // Nothing to measure from: keep coverage null rather than libel the repo as untested.
  if (!direct.size) return { direct, reached: direct };

  const reached = reachableFrom(direct, adjacency(edges, (e) => e.kind === "import"));

  for (const n of nodes) {
    if (n.kind !== "file" || UNREACHED_LAYERS.has(n.layer)) continue;
    n.coverage = direct.has(n.id) ? "direct" : reached.has(n.id) ? "indirect" : "none";
    n.uncovered = n.coverage === "none";
  }

}
