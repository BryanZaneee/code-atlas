/* ════════════════════ sidebar ════════════════════ */
function renderViews() {
  const w = $("#views"); w.innerHTML = "";
  for (const v of VIEWS) {
    const btn = el("button", S.view === v.id ? "on" : null, v.label);
    btn.onclick = () => setView(v.id);
    w.append(btn);
  }
}



/**
 * The same relation TRAVELLED BY shows, read from the other end: which of these
 * flows does the selected node lie on? One index, two directions.
 *
 * A class toggle rather than a re-render, so selecting a block does not rebuild
 * the list under the cursor you are about to click with.
 */
function markFlowRows() {
  const on = new Set(byId.get(S.selected)?.travelledBy ?? []);
  for (const r of document.querySelectorAll("#list .row[data-flow]")) {
    r.classList.toggle("onpath", on.has(r.dataset.flow));
  }
}

function renderList() {
  const wrap = $("#list"); wrap.innerHTML = "";
  const title = $("#listTitle"), count = $("#listCount");

  if (isFlowView(S.view)) {
    title.textContent = viewById.get(S.view)?.listLabel ?? "PATHS";
    const fs = flowsForView(S.view);
    count.textContent = fs.length;
    const all = el("div", "row" + (S.activeFlow === "__all__" ? " sel" : ""));
    all.append(el("span", "sw"), el("span", "nm", "▸ ALL"), el("span", "num", fs.reduce((a, f) => a + f.steps.length, 0) + " steps"));
    all.querySelector(".sw").style.background = "transparent";
    all.onclick = () => { S.activeFlow = "__all__"; relayout(); renderList(); fitView(); renderCaption(); };
    wrap.append(all);
    for (const f of fs) {
      const r = el("div", "row" + (S.activeFlow === f.id ? " sel" : ""));
      r.dataset.flow = f.id;
      const sw = el("span", "sw"); sw.style.background = EDGE_STYLE.http.c;
      r.append(sw, el("span", "nm", f.label), el("span", "num", f.steps.length));
      r.onclick = () => { S.activeFlow = f.id; S.pinnedPacket = null; relayout(); renderList(); fitView(); renderInspect(); renderCaption(); };
      wrap.append(r);
      if (S.activeFlow === f.id && f.blurb) wrap.append(el("div", "hint", f.blurb));
    }
    markFlowRows();
    return;
  }

  title.textContent = "AREAS";
  const ds = LAYOUT.districts.slice().sort((a, b) =>
    (svcById.get(a.service)?.order ?? 9) - (svcById.get(b.service)?.order ?? 9) ||
    (layerById.get(a.layer)?.rank ?? 99) - (layerById.get(b.layer)?.rank ?? 99));
  count.textContent = ds.length;

  const whole = el("div", "row" + (!S.focusDistrict ? " sel" : ""));
  whole.append(el("span", "sw"), el("span", "nm", "whole system"), el("span", "num", LAYOUT.nodes.length));
  whole.querySelector(".sw").style.background = "transparent";
  whole.onclick = () => { S.focusDistrict = null; S.selected = null; renderList(); renderInspect(); fitView(); };
  wrap.append(whole);

  let lastSvc = null;
  for (const d of ds) {
    if (d.service !== lastSvc) {
      lastSvc = d.service;
      const h = el("div", "hint");
      h.style.cssText = "margin-top:7px;letter-spacing:.12em;color:var(--dim)";
      h.textContent = (svcById.get(d.service)?.label ?? d.service).toUpperCase();
      wrap.append(h);
    }
    const r = el("div", "row" + (S.focusDistrict === d.id ? " sel" : ""));
    const sw = el("span", "sw"); sw.style.background = layerById.get(d.layer)?.color ?? THEME.layerFallback;
    r.append(sw, el("span", "nm", d.label.toLowerCase()), el("span", "num", d.members.length));
    r.onclick = () => {
      S.focusDistrict = S.focusDistrict === d.id ? null : d.id;
      S.selected = null; S.pinnedPacket = null;
      renderList(); renderInspect(); staticDirty = true;
      if (S.focusDistrict) focusOn(d);
    };
    wrap.append(r);
  }
}

function renderServices() {
  const w = $("#svc"); w.innerHTML = "";
  for (const s of ATLAS.services) {
    const n = ATLAS.nodes.filter(x => x.service === s.id && x.kind === "file").length;
    if (!n) continue;
    const lab = el("label", "chk");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = S.services.has(s.id);
    cb.onchange = () => {
      cb.checked ? S.services.add(s.id) : S.services.delete(s.id);
      relayout(); renderList(); fitView();
    };
    lab.append(cb, el("span", "nm", s.label), el("span", "num", n));
    w.append(lab);
  }
}

function renderStats() {
  const m = ATLAS.meta;
  $("#bRepo").textContent = m.repo;
  $("#bRef").textContent = `${m.ref} @ ${m.commit} · ${m.generatedAt}`;
  const rows = viewKind(S.view) === "tests"
    ? [
        ["TEST FILES", fmt(m.testCount)], ["SUITES", fmt(m.suiteCount)],
        ["DIRECT", fmt(m.coverDirect)], ["INDIRECT", fmt(m.coverIndirect)],
        ["NO TEST REACHES", fmt(m.coverNone)], ["LINKS", fmt(m.edgeCount)],
      ]
    : [
        ["NODES", fmt(m.nodeCount)], ["SOURCE FILES", fmt(m.fileCount)], ["LINES", fmt(m.lineCount)],
        ["LINKS", fmt(m.edgeCount)], ["ENDPOINTS", fmt(m.endpointCount)], ["TESTS", fmt(m.testCount)],
        ["PACKAGES", fmt(m.packageCount)],
      ];
  const w = $("#stats"); w.innerHTML = "";
  for (const [k, v] of rows) {
    const d = el("div", "stat");
    d.append(el("div", "k", k), el("div", "v", v));
    w.append(d);
  }
}

function renderLegend() {
  // Rows name a key in the theme tables rather than repeating a colour, so the
  // legend cannot drift out of step with what is actually drawn.
  const rows = THEME.legend[viewKind(S.view) === "tests" ? "tests" : "default"] ?? [];
  const w = $("#legend"); w.innerHTML = "";
  for (const r of rows) {
    const style = r.edge ? EDGE_STYLE[r.edge] : null;
    const color = style?.c
      ?? (r.swatch ? PACKET_COLOR[r.swatch] : null)
      ?? (r.tint ? COVER_TINT[r.tint] : null)
      ?? (r.layer ? layerById.get(r.layer)?.color : null)
      ?? THEME.layerFallback;
    const g = el("div", "lg");
    const mark = el(r.edge ? "i" : "u");
    if (r.edge) { mark.style.borderTopColor = color; if (style?.dash) mark.className = "dash"; }
    else mark.style.background = color;
    g.append(mark, el("span", null, r.label));
    w.append(g);
  }
  const right = el("div", "lg");
  right.style.marginLeft = "auto";
  right.append(el("span", null, "READ-ONLY PROJECTION · NO SOURCE EMBEDDED"));
  w.append(right);
}

