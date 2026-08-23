/* ═══ inspect panel ═══ */
function selectStep(st) {
  S.pinnedPacket = st;
  S.selected = st.to;
  renderInspect();
}
function enterFlow(flowId, fromId) {
  const f = flowById.get(flowId);
  if (!f) return;
  setView(f.view);
  S.activeFlow = flowId;
  relayout();
  renderList();
  fitView();
  const r = runners[0];
  if (r) {
    const i = r.steps.findIndex((s) => s.to === fromId);
    if (i >= 0) r.i = i;
  }
  S.selected = fromId;
  renderInspect();
  renderCaption();
}
function renderInspect() {
  markFlowRows();
  // The breadcrumb answers "where am I", so it tracks the inspector rather than
  // each of the eight places that set S.selected and then re-render.
  renderBreadcrumb();
  const b = $("#insBody");
  b.innerHTML = "";
  if (S.insTab === "notes") { renderNotes(b); return; }
  const finding = S.selected || S.pinnedPacket ? null : findSelected();
  if (finding) { renderFinding(b, finding); return; }
  if (viewKind(S.view) === "request" && !S.pinnedPacket && !S.selected) { renderComposer(b); return; }
  if (S.pinnedPacket) {
    const st = S.pinnedPacket;
    const f = flowById.get(st.flowId) ?? (S.request?.id === st.flowId ? S.request : null);
    b.append(el("div", "title", st.label || "packet"));
    b.append(el("div", "path", `${f ? f.label + " · " : ""}step ${st.i + 1}`));
    const dl = el("dl", "kv");
    const add = (k, v) => { dl.append(el("dt", null, k), el("dd", null, v)); };
    add("KIND", st.kind);
    if (st.certainty) add("CERTAINTY", CERTAINTY_LABEL[st.certainty] ?? st.certainty);
    add("FROM", byId.get(st.from)?.name ?? st.from);
    add("TO", byId.get(st.to)?.name ?? st.to);
    b.append(dl);
    if (st.note) b.append(el("div", "note" + (st.warn ? " warn" : ""), st.note));
    if (st.sample) {
      b.append(el("h3", null, "PACKET PAYLOAD (SYNTHETIC)"));
      b.append(el("pre", "sample", JSON.stringify(st.sample, null, 2)));
    }
    const justifies = srcHopImport(st);
    const hop = justifies && srcJump("⤷ IMPORT IN", justifies.path, justifies.line);
    if (hop) b.append(hop);
    const back = el("button", null, "← CLEAR PACKET");
    back.style.marginTop = "9px";
    back.onclick = () => { S.pinnedPacket = null; renderInspect(); };
    b.append(back);
    return;
  }
  if (S.focusDistrict && !S.selected) {
    const d = LAYOUT.districts.find(x => x.id === S.focusDistrict);
    if (d) {
      b.append(el("div", "eyebrow", (svcById.get(d.service)?.label ?? d.service).toUpperCase()));
      b.append(el("div", "title", d.label));
      b.append(el("div", "path", `${d.blocks.length} file${d.blocks.length === 1 ? "" : "s"}`));
      const dl = el("dl", "kv");
      dl.append(el("dt", null, "LINES"), el("dd", null, fmt(d.blocks.reduce((a, n) => a + n.loc, 0))));
      b.append(dl);
      b.append(el("h3", null, "SHAPE"));
      const rowS = el("div");
      const cur = S.shapeByDistrict.get(d.id) ?? "auto";
      for (const idd of ["auto", ...SHAPE_IDS]) {
        const t = el("span", "tag act", idd === "auto" ? "auto" : SHAPES[idd].label.toLowerCase());
        if (cur === idd) { t.style.background = "var(--accent)"; t.style.color = "var(--bg)"; }
        t.onclick = () => {
          if (idd === "auto") S.shapeByDistrict.delete(d.id);
          else S.shapeByDistrict.set(d.id, idd);
          reproject(); buildPackets(); staticDirty = true; renderInspect();
        };
        rowS.append(t);
      }
      b.append(rowS);
      b.append(el("div", "hint", "Overrides the map-wide shape for just this district."));
      const col = el("button", null, d.collapsed ? "◧ EXPAND DISTRICT" : "▣ COLLAPSE TO MEGABLOCK");
      col.style.marginTop = "8px";
      col.onclick = () => toggleCollapse(d.id);
      b.append(col);
      b.append(el("div", "hint", "One block, height is the district's total lines — the module-level read. Double-clicking the plate does the same."));
      b.append(el("h3", null, "FILES"));
      for (const n of d.blocks.slice().sort((a, x) => x.loc - a.loc)) {
        const r = el("div", "row mini");
        r.append(el("span", "nm", n.name), el("span", "num", `${n.loc}L`));
        r.onclick = () => { S.selected = n.id; renderInspect(); };
        b.append(r);
      }
      return;
    }
  }
  const n = byId.get(S.selected);
  if (!n) {
    const here = viewById.get(S.view)?.label ?? "this view";
    b.append(el("div", "hint", `Choose a block in the map, a district on the left, or click a moving packet. The packets follow real relationships — imports in ${here}, curated call order in a flow view.`));
    return;
  }
  b.append(el("div", "eyebrow", (layerById.get(n.layer)?.label ?? n.layer).toUpperCase()));
  b.append(el("div", "title", n.name));
  if (n.kind === "file") {
    const parts = [`${fmt(n.loc)} lines`];
    if (n.inDeg || n.outDeg) parts.push(`${n.inDeg} in · ${n.outDeg} out`);
    b.append(el("div", "meta", parts.join(" · ")));
  }
  b.append(el("div", "path", n.id));
  const dl = el("dl", "kv");
  const add = (k, v, why) => {
    const dd = el("dd", null, v);
    if (why) dd.append(el("div", "why", why));
    dl.append(el("dt", null, k), dd);
  };
  add("SERVICE", svcById.get(n.service)?.label ?? n.service, n.serviceWhy);
  add("LAYER", layerById.get(n.layer)?.label ?? n.layer, n.layerWhy);
  if (n.kind === "file") {
    add("LINES", fmt(n.loc));
    add("EXPORTS", n.exports);
  }
  add("KIND", n.kind, n.why);
  add("IN / OUT", `${n.inDeg} in · ${n.outDeg} out`);
  if (n.testKind) add("SUITE", n.testKind);
  if (n.subject) add("COVERS", byId.get(n.subject)?.name ?? n.subject);
  b.append(dl);
  const ep = n.kind === "endpoint" ? srcEndpoint(n.id) : null;
  for (const jump of [
    ep ? srcJump("⤷ ROUTE IN", ep.definedIn, ep.line) : null,
    n.kind === "file" ? srcJump("⤷ READ", n.id, 0) : null,
    n.subject ? srcJump("⤷ COVERS", n.subject, 0) : null,
  ]) if (jump) b.append(jump);
  if (n.note) b.append(el("div", "note", n.note));
  if (n.coverage) {
    const txt = {
      direct: "A test file imports this module directly.",
      indirect: "No test imports this module, but it is reachable through the import graph from one that is tested — a route file reached through an app factory lands here.",
      none: "Not reachable from any test file through imports. Derived from test imports plus the test\u2194source naming convention, never from execution — this is a claim about the import graph, not about what ran.",
    }[n.coverage];
    b.append(el("div", "note" + (n.coverage === "none" ? " warn" : ""), `COVERAGE: ${n.coverage.toUpperCase()} — ${txt}`));
  }
  if (n.travelledBy?.length) {
    b.append(el("h3", null, "TRAVELLED BY"));
    const w = el("div");
    for (const id of n.travelledBy) {
      const f = flowById.get(id);
      if (!f) continue;
      const c = el("span", "tag act", f.label);
      c.onclick = () => enterFlow(id, n.id);
      w.append(c);
    }
    b.append(w);
  }
  if (n.externals?.length) {
    b.append(el("h3", null, "EXTERNAL PACKAGES"));
    const w = el("div");
    n.externals.forEach(x => w.append(el("span", "tag", x)));
    b.append(w);
  }
  const outs = (edgesFrom.get(n.id) ?? []).filter(e => e.kind !== "test:exercises");
  const ins = (edgesTo.get(n.id) ?? []).filter(e => e.kind !== "test:exercises");
  renderAppearance(b, n);
  const list = (title, arr, key) => {
    if (!arr.length) return;
    b.append(el("h3", null, `${title} (${arr.length})`));
    for (const e of arr.slice(0, 26)) {
      const t = byId.get(e[key]);
      const r = el("div", "row mini");
      r.append(el("span", "nm", t?.name ?? e[key]), el("span", "sub", e.kind));
      const jump = srcJump(null, e.line ? e.from : null, e.line);
      if (jump) r.append(jump);
      // `goTo` rather than a bare assignment: the target may be filtered out, collapsed into a megablock or in a service that is switched off, and following an import to a block you cannot see is not following it.
      r.onclick = () => goTo(e[key]);
      b.append(r);
      if (e.note) b.append(el("div", "note warn", e.note));
    }
  };
  list("IMPORTS / CALLS", outs, "to");
  list("USED BY", ins, "from");
}
