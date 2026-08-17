/* ════════════════════ which nodes / edges each view shows ════════════════════ */
function flowsForView(v) { return ATLAS.flows.filter(f => f.view === v); }

function activeFlows() {
  const fs = flowsForView(S.view);
  if (!fs.length) return [];
  return S.activeFlow === "__all__" ? fs : fs.filter(f => f.id === S.activeFlow);
}

function visibleSet() {
  const keep = new Set();
  const add = (id) => { const n = byId.get(id); if (n) keep.add(n); };

  if (isFlowView(S.view)) {
    for (const f of activeFlows()) for (const s of f.steps) { add(s.from); add(s.to); }
    return [...keep];
  }

  for (const n of ATLAS.nodes) {
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

