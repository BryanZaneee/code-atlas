/* ════════════════════ which nodes / edges each view shows ════════════════════ */
function flowsForView(v) { return ATLAS.flows.filter(f => f.view === v); }

function activeFlows() {
  const fs = flowsForView(S.view);
  if (!fs.length) return [];
  return S.activeFlow === "__all__" ? fs : fs.filter(f => f.id === S.activeFlow);
}

/** The nodes the active flows pass through, and the step each one is. */
function pathSteps() {
  const at = new Map();
  for (const f of activeFlows()) {
    // The badge is the position of the hop that ARRIVES here; the origin is 1.
    // A branching flow can reach one node twice, and the first arrival wins.
    f.steps.forEach((s, i) => {
      if (!at.has(s.from)) at.set(s.from, i + 1);
      if (!at.has(s.to)) at.set(s.to, i + 2);
    });
  }
  return at;
}

/**
 * A flow view used to show ONLY the nodes on the flow, which meant entering one
 * threw away the map you were reading. Off-path geometry stays and is dimmed
 * instead: dimming preserves spatial context, hiding destroys it. The flow
 * decides emphasis, not membership.
 */
function visibleSet() {
  const keep = new Set();
  const onPath = isFlowView(S.view) ? pathSteps() : null;

  // ISOLATED: only the flow, re-packed by relayout() into its own districts.
  // This is deliberately a different LAYOUT and not a filter — the blocks move,
  // which is the whole point. Dimming keeps a node where it was and answers
  // "where does this sit"; isolating answers "what is this path", and a reader
  // wants one question at a time.
  if (onPath && S.isolate) {
    for (const n of ATLAS.nodes) if (onPath.has(n.id)) keep.add(n);
    return [...keep];
  }

  for (const n of ATLAS.nodes) {
    // A flow's own endpoints and datastores are always on the map, whatever the
    // sidebar filters say — they are the thing being traced.
    if (onPath?.has(n.id)) { keep.add(n); continue; }
    if (n.kind === "endpoint") continue;
    if (n.lang === "md" && !S.opts.docs) continue;
    if (!S.services.has(n.service)) continue;
    if (viewKind(S.view) === "structure" && n.layer === "test" && !S.opts.tests) continue;
    if (viewKind(S.view) === "tests" && n.layer === "docs") continue;
    keep.add(n);
  }
  return [...keep];
}

function visibleEdges(vis) {
  const ids = new Set(vis.map(n => n.id));
  const flowSteps = new Set();
  for (const f of activeFlows()) for (const s of f.steps) flowSteps.add(`${s.from}|${s.to}`);

  return ATLAS.edges.filter(e => {
    if (!ids.has(e.from) || !ids.has(e.to)) return false;
    if (isFlowView(S.view)) return flowSteps.has(`${e.from}|${e.to}`);
    if (viewKind(S.view) === "tests") return e.kind.startsWith("test:") || e.kind === "coupling";
    if (e.kind.startsWith("test:")) return false;
    if (!S.opts.contract) {
      const a = byId.get(e.to);
      if (a && a.layer === "contract") return false;
    }
    return true;
  });
}

