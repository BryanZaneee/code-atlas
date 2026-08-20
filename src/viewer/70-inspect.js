/* ════════════════════ inspect panel ════════════════════ */

function selectStep(st) {
  S.pinnedPacket = st;
  S.selected = st.to;
  renderInspect();
}

/**
 * Enter a flow from a node that lies on it.
 *
 * Two details are what make this feel like it understood the question rather
 * than merely being wired up. It opens at *this node's* hop, not hop 1 — you
 * came from somewhere, and the tool knows where. And the node you came from
 * stays selected, so it keeps its silhouette through the trace and you never
 * lose the thing you were asking about.
 */
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
  const b = $("#insBody");
  b.innerHTML = "";

  // A lit finding owns the panel until you click past it — into one of its own
  // evidence rows, or onto a block on the map. Both of those set `selected`,
  // and the map keeps the highlight while you read what you clicked.
  const finding = S.selected || S.pinnedPacket ? null : findSelected();
  if (finding) { renderFinding(b, finding); return; }

  if (S.pinnedPacket) {
    const st = S.pinnedPacket;
    const f = flowById.get(st.flowId);
    b.append(el("div", "title", st.label || "packet"));
    b.append(el("div", "path", `${f ? f.label + " · " : ""}step ${st.i + 1}`));
    const dl = el("dl", "kv");
    const add = (k, v) => { dl.append(el("dt", null, k), el("dd", null, v)); };
    add("KIND", st.kind);
    // A derived hop carries how it was justified. The canvas already says it in
    // weight and dash; spelling it out is what turns "that line looks thinner"
    // into a fact you can quote.
    if (st.certainty) add("CERTAINTY", CERTAINTY_LABEL[st.certainty] ?? st.certainty);
    add("FROM", byId.get(st.from)?.name ?? st.from);
    add("TO", byId.get(st.to)?.name ?? st.to);
    b.append(dl);
    if (st.note) b.append(el("div", "note" + (st.warn ? " warn" : ""), st.note));
    if (st.sample) {
      b.append(el("h3", null, "PACKET PAYLOAD (SYNTHETIC)"));
      const pre = el("pre", "sample", JSON.stringify(st.sample, null, 2));
      b.append(pre);
    }
    // The hop's justifying import, when there is one. An inferred hop crossed a
    // gap in the import graph and has no line to open — so it is offered no
    // button, rather than one that lands somewhere plausible.
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
      b.append(el("div", "title", `${svcById.get(d.service)?.label ?? d.service}`));
      b.append(el("div", "path", `${d.label.toLowerCase()} · ${d.blocks.length} files`));
      const dl = el("dl", "kv");
      dl.append(el("dt", null, "LINES"), el("dd", null, fmt(d.blocks.reduce((a, n) => a + n.loc, 0))));
      b.append(dl);
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
    // Names the current view by its own label rather than a hardcoded one: a
    // config can rename any view, and prose pointing at a button that does not
    // exist is worse than prose that says less.
    const here = viewById.get(S.view)?.label ?? "this view";
    b.append(el("div", "hint", `Choose a block in the map, a district on the left, or click a moving packet. The packets follow real relationships — imports in ${here}, curated call order in a flow view.`));
    return;
  }

  // Eyebrow, title, meta — what kind of thing, what it is called, how big.
  b.append(el("div", "eyebrow", (layerById.get(n.layer)?.label ?? n.layer).toUpperCase()));
  b.append(el("div", "title", n.name));
  if (n.kind === "file") {
    const parts = [`${fmt(n.loc)} lines`];
    if (n.inDeg || n.outDeg) parts.push(`${n.inDeg} in · ${n.outDeg} out`);
    b.append(el("div", "meta", parts.join(" · ")));
  }
  b.append(el("div", "path", n.id));
  const dl = el("dl", "kv");
  // `why` is the rule that placed this node. Showing it is what turns "the tool
  // put my file in the wrong column" into a config edit instead of a bug report.
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
  add("KIND", n.kind);
  add("IN / OUT", `${n.inDeg} in · ${n.outDeg} out`);
  if (n.testKind) add("SUITE", n.testKind);
  if (n.subject) add("COVERS", byId.get(n.subject)?.name ?? n.subject);
  b.append(dl);

  // Read the thing itself. An endpoint opens the file at the line that declares
  // the route; a file opens at its top; a test offers the file it covers.
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

  // TRAVELLED BY is a control, not a label: it is the way from *a thing* to
  // *what happens to that thing*. Absent when nothing passes through, which is
  // most nodes — an empty section reads as a broken panel, not as an honest one.
  if (n.travelledBy?.length) {
    b.append(el("h3", null, "TRAVELLED BY"));
    const w = el("div");
    for (const id of n.travelledBy) {
      const f = flowById.get(id);
      if (!f) continue;
      const chip = el("span", "tag act", f.label);
      chip.onclick = () => enterFlow(id, n.id);
      w.append(chip);
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
  const list = (title, arr, key) => {
    if (!arr.length) return;
    b.append(el("h3", null, `${title} (${arr.length})`));
    for (const e of arr.slice(0, 26)) {
      const t = byId.get(e[key]);
      const r = el("div", "row mini");
      r.append(el("span", "nm", t?.name ?? e[key]), el("span", "sub", e.kind));
      // The import statement lives in the edge's `from` file, whichever
      // direction this list is reading the edge from.
      const jump = srcJump(null, e.line ? e.from : null, e.line);
      if (jump) r.append(jump);
      r.onclick = () => { S.selected = e[key]; S.pinnedPacket = null; renderInspect(); };
      b.append(r);
      if (e.note) b.append(el("div", "note warn", e.note));
    }
  };
  list("IMPORTS / CALLS", outs, "to");
  list("USED BY", ins, "from");
}

