/**
 * Coverage, derived from imports rather than from a coverage tool.
 *
 * A route test imports the app factory, not the router, so "no test imports
 * this" is not the same as "untested". Three states rather than a bare
 * uncovered flag, which would libel well-tested files:
 *
 *   direct    a test imports it
 *   indirect  reachable through the import graph from something a test imports
 *   none      no test reaches it at all — the only one that means untested
 *
 * Phase 2 makes this `null` everywhere when a repo has no tests, so an untested
 * repo reads as "not measured" instead of an all-orange map.
 */
const NOT_MEASURED = ["test", "tooling", "docs", "migration"];

export function deriveCoverage(nodes, edges) {
  const direct = new Set(edges.filter((e) => e.kind.startsWith("test:")).map((e) => e.to));

  // Nothing to measure from: no tests, or tests whose imports this language's
  // adapter cannot resolve. Either way the answer is "not measured" and every
  // node keeps coverage null. Reporting "none" everywhere would be an all-orange
  // map that reads as "your code is untested" on evidence we do not have.
  if (!direct.size) return { direct, reached: direct };

  const reached = new Set(direct);

  const outImports = new Map();
  for (const e of edges) {
    if (e.kind !== "import") continue;
    if (!outImports.has(e.from)) outImports.set(e.from, []);
    outImports.get(e.from).push(e.to);
  }

  const queue = [...direct];
  while (queue.length) {
    for (const next of outImports.get(queue.pop()) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  for (const n of nodes) {
    if (n.kind !== "file" || NOT_MEASURED.includes(n.layer)) continue;
    n.coverage = direct.has(n.id) ? "direct" : reached.has(n.id) ? "indirect" : "none";
    n.uncovered = n.coverage === "none";
  }

}
