/* ════════════════════ which nodes / edges each view shows ════════════════════ */
function flowsForView(v) { return ALL_FLOWS.filter(f => f.view === v); }

function activeFlows() {
  // The armed request path has no ALL_FLOWS entry, so it is handled before flowsForView().
  if (viewKind(S.view) === "request") return S.request ? [S.request] : [];
  const fs = flowsForView(S.view);
  if (!fs.length) return [];
  return S.activeFlow === "__all__" ? fs : fs.filter(f => f.id === S.activeFlow);
}

/** The nodes the active flows pass through, and the step each one is. */
function pathSteps() {
  const at = new Map();
  for (const f of activeFlows()) {
    // Badge is the arriving hop's position, origin 1; on a branching flow the first arrival wins.
    f.steps.forEach((s, i) => {
      if (!at.has(s.from)) at.set(s.from, i + 1);
      if (!at.has(s.to)) at.set(s.to, i + 2);
    });
  }
  return at;
}

/** Off-path geometry is dimmed, not dropped: the flow decides emphasis, not membership. */
function visibleSet() {
  const keep = new Set();
  const kind = viewKind(S.view);
  const onPath = playsFlow(S.view) ? pathSteps() : null;
  // Evidence ignores the sidebar filters, or a finding would light up nothing and read as being about nowhere.
  const evidence = findEvidenceIds();

  // Isolation is a different layout, not a filter: relayout() re-packs the flow into its own districts.
  if (onPath && S.isolate) {
    for (const n of ATLAS.nodes) if (onPath.has(n.id)) keep.add(n);
    return [...keep];
  }

  for (const n of ATLAS.nodes) {
    // A flow's own nodes stay on the map whatever the sidebar filters say.
    if (onPath?.has(n.id)) { keep.add(n); continue; }
    if (evidence?.has(n.id)) { keep.add(n); continue; }
    if (n.kind === "endpoint") continue;
    if (n.lang === "md" && !S.opts.docs) continue;
    if (!S.services.has(n.service)) continue;
    // The findings view draws the structure view's city, so a finding lights up in the place you were just reading.
    if ((kind === "structure" || kind === "findings") && n.layer === "test" && !S.opts.tests) continue;
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

