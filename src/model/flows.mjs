/**
 * Curated flow validation.
 *
 * Static imports cannot express request ordering, so flows are hand-authored.
 * That makes them the one part of the payload that can silently rot: a rename
 * leaves a step pointing at an id that no longer exists, and the map then draws
 * a chain that is not there. Every from/to is checked against the scanned node
 * set instead.
 *
 * Phase 2 demotes this to a warning with --strict restoring the hard fail,
 * because a stale curated flow must not be fatal for a general-purpose tool.
 * Phase 6 derives paths so that curation becomes an enhancement rather than a
 * requirement.
 */
export function validateFlows({ flows = [], extraEdges = [] }, nodeIds) {
  const bad = [];
  for (const f of flows) {
    for (const [i, s] of f.steps.entries()) {
      if (!nodeIds.has(s.from)) bad.push(`flow "${f.id}" step ${i}: unknown from "${s.from}"`);
      if (!nodeIds.has(s.to)) bad.push(`flow "${f.id}" step ${i}: unknown to "${s.to}"`);
    }
  }
  for (const e of extraEdges) {
    if (!nodeIds.has(e.from)) bad.push(`extra edge: unknown from "${e.from}"`);
    if (!nodeIds.has(e.to)) bad.push(`extra edge: unknown to "${e.to}"`);
  }
  return bad;
}
