/* ═══ selection: which nodes / edges each view shows ═══ */
function flowsForView(v) { return ALL_FLOWS.filter(f => f.view === v); }
function activeFlows() {
  if (viewKind(S.view) === "request") return S.request ? [S.request] : reqOverviewFlows();
  const fs = flowsForView(S.view);
  if (!fs.length) return [];
  return S.activeFlow === "__all__" ? fs : fs.filter(f => f.id === S.activeFlow);
}
function pathSteps() {
  const at = new Map();
  for (const f of activeFlows()) f.steps.forEach((s, i) => {
    if (!at.has(s.from)) at.set(s.from, i + 1);
    if (!at.has(s.to)) at.set(s.to, i + 2);
  });
  return at;
}
function visibleSet() {
  const keep = new Set();
  const kind = viewKind(S.view);
  const onPath = playsFlow(S.view) ? pathSteps() : null;
  const evidence = findEvidenceIds();
  if (onPath && S.isolate) {
    for (const n of ATLAS.nodes) if (onPath.has(n.id)) keep.add(n);
    return [...keep];
  }
  for (const n of ATLAS.nodes) {
    if (onPath?.has(n.id)) { keep.add(n); continue; }
    if (evidence?.has(n.id)) { keep.add(n); continue; }
    if (n.vendor && !S.opts.vendor) continue;
    if (n.kind === "endpoint") continue;
    if (n.lang === "md" && !S.opts.docs) continue;
    if (!S.services.has(n.service)) continue;
    if (isCityKind(kind) && n.layer === "test" && !S.opts.tests) continue;
    if (kind === "tests" && n.layer === "docs") continue;
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
    if (playsFlow(S.view)) return flowSteps.has(`${e.from}|${e.to}`);
    if (viewKind(S.view) === "tests") return e.kind.startsWith("test:") || e.kind === "coupling";
    if (e.kind.startsWith("test:")) return false;
    if (!S.opts.contract) {
      const a = byId.get(e.to);
      if (a && a.layer === "contract") return false;
    }
    return true;
  });
}
