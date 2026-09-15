/* ═══ sidebar ═══ */
function renderViews() {
  const w = $("#views"); w.innerHTML = "";
  for (const v of VIEWS) {
    const btn = el("button", S.view === v.id ? "on" : null, v.label);
    btn.onclick = () => setView(v.id);
    w.append(btn);
  }
}
function markFlowRows() {
  const on = new Set(byId.get(S.selected)?.travelledBy ?? []);
  for (const r of document.querySelectorAll("#list .row[data-flow]")) {
    r.classList.toggle("onpath", on.has(r.dataset.flow));
  }
}
function swatchFor(layer) {
  const sw = el("span", "sw");
  sw.style.background = S.colorMode === "identity" ? layerColorOf(layer) : "transparent";
  return sw;
}
function renderList() {
  const wrap = $("#list"); wrap.innerHTML = "";
  const title = $("#listTitle"), count = $("#listCount");
  if (viewKind(S.view) === "findings") { renderFindingList(wrap, title, count); return; }
  if (viewKind(S.view) === "request") { renderRequestList(wrap, title, count); return; }
  if (isFlowView(S.view)) {
    title.textContent = viewById.get(S.view)?.listLabel ?? "PATHS";
    const fs = flowsForView(S.view);
    count.textContent = fs.length;
    const all = el("button", "row flow" + (S.activeFlow === "__all__" ? " sel" : ""));
    all.append(el("span", "mk", "▶"), el("span", "nm", "all paths"),
      el("span", "num", fs.reduce((a, f) => a + f.steps.length, 0) + " steps"));
    all.onclick = () => { S.activeFlow = "__all__"; relayout(); renderList(); fitView(); renderCaption(); syncControls(); };
    wrap.append(all);
    for (const f of fs) {
      const r = el("button", "row flow" + (S.activeFlow === f.id ? " sel" : ""));
      r.dataset.flow = f.id;
      r.append(el("span", "mk", "▶"), el("span", "nm", f.label), el("span", "num", f.steps.length));
      r.onclick = () => { S.activeFlow = f.id; S.pinnedPacket = null; relayout(); renderList(); fitView(); renderInspect(); renderCaption(); syncControls(); };
      wrap.append(r);
      if (S.activeFlow === f.id && f.blurb) wrap.append(el("div", "hint", f.blurb));
    }
    markFlowRows();
    return;
  }
  title.textContent = S.group === "folder" ? "FOLDERS" : "AREAS";
  const ds = LAYOUT.districts.slice().sort((a, b) =>
    (svcById.get(a.service)?.order ?? 9) - (svcById.get(b.service)?.order ?? 9) ||
    keyCompare(a.key, b.key));
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
      wrap.append(el("div", "hint grp", (svcById.get(d.service)?.label ?? d.service).toUpperCase()));
    }
    const r = el("div", "row" + (S.focusDistrict === d.id ? " sel" : ""));
    const sw = el("span", "sw");
    sw.style.background = S.colorMode === "identity" && d.blocks[0] ? colorOf(d.blocks[0]) : "transparent";
    r.append(sw, el("span", "nm", d.label.toLowerCase()), el("span", "num", d.blocks.length));
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
  const services = ATLAS.services.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  for (const s of services) {
    const files = ATLAS.nodes.filter((x) => x.service === s.id && x.kind === "file" && (!x.vendor || S.opts.vendor));
    if (!files.length) continue;
    const det = el("details", "svc");
    if (S.openServices.has(s.id)) det.open = true;
    det.ontoggle = () => det.open ? S.openServices.add(s.id) : S.openServices.delete(s.id);
    const sum = el("summary");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = S.services.has(s.id);
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => {
      cb.checked ? S.services.add(s.id) : S.services.delete(s.id);
      relayout(); renderList(); fitView();
    };
    sum.append(cb, el("span", "nm", s.label), el("span", "num", files.length));
    det.append(sum);
    const inner = el("div", "svcBody");
    const keys = [...new Set(files.map((f) => groupKeyOf(f)))].sort(keyCompare);
    for (const key of keys) {
      const members = files.filter((f) => groupKeyOf(f) === key);
      const id = districtId(s.id, key);
      const r = el("div", "row mini" + (S.focusDistrict === id ? " sel" : ""));
      r.append(swatchFor(members[0].layer), el("span", "nm", labelForKey(key).toLowerCase()), el("span", "num", members.length));
      r.onclick = () => {
        S.focusDistrict = S.focusDistrict === id ? null : id;
        S.selected = null; S.pinnedPacket = null;
        renderList(); renderServices(); renderInspect(); staticDirty = true;
        const d = LAYOUT.districts.find((x) => x.id === id);
        if (S.focusDistrict && d) focusOn(d);
      };
      inner.append(r);
    }
    det.append(inner);
    w.append(det);
  }
}
function renderStats() {
  const m = ATLAS.meta;
  $("#bRepo").textContent = m.repo;
  const kind = viewKind(S.view);
  const sevCount = (sev) => FINDINGS.filter((f) => !f.muted && f.severity === sev).length;
  const rows = kind === "findings"
    ? [["ERROR", fmt(sevCount("error"))], ["WARNING", fmt(sevCount("warning"))],
       ["INFO", fmt(sevCount("info"))], ["MUTED", fmt(FINDINGS.filter((f) => f.muted).length)],
       ["SOURCE FILES", fmt(m.fileCount)], ["LINKS", fmt(m.edgeCount)]]
    : kind === "tests"
    ? [["TEST FILES", fmt(m.testCount)], ["SUITES", fmt(m.suiteCount)],
       ["DIRECT", fmt(m.coverDirect)], ["INDIRECT", fmt(m.coverIndirect)],
       ["NO TEST REACHES", fmt(m.coverNone)], ["LINKS", fmt(m.edgeCount)]]
    : [["DERIVED · UNMAPPED", `${fmt(m.derivedCount)} · ${fmt(m.unsortedCount)}`],
       ["NODES", fmt(m.nodeCount)], ["SOURCE FILES", fmt(m.fileCount)], ["LINES", fmt(m.lineCount)],
       ["LINKS", fmt(m.edgeCount)], ["ENDPOINTS", fmt(m.endpointCount)], ["TESTS", fmt(m.testCount)]];
  const w = $("#stats"); w.innerHTML = "";
  for (const [k, v] of rows) {
    const d = el("div", "stat");
    d.append(el("div", "k", k), el("div", "v", v));
    w.append(d);
  }
}
function renderLegend() {
  const rows = THEME.legend[viewKind(S.view)] ?? THEME.legend.default ?? [];
  const w = $("#legend"); w.innerHTML = "";
  for (const r of rows) {
    const style = r.edge ? EDGE_STYLE[r.edge] : null;
    const color = style?.c
      ?? (r.swatch ? PACKET_COLOR[r.swatch] : null)
      ?? (r.tint ? COVER_TINT[r.tint] : null)
      ?? (r.sev ? THEME.findingSeverity?.[r.sev] : null)
      ?? (r.layer ? layerColorOf(r.layer) : null)
      ?? THEME.layerFallback;
    const g = el("div", "lg");
    const line = r.edge || r.sev;
    const mark = el(line ? "i" : "u");
    if (line) { mark.style.borderTopColor = color; if (style?.dash || r.dash) mark.className = "dash"; }
    else mark.style.background = color;
    g.append(mark, el("span", null, r.label));
    w.append(g);
  }
  const right = el("div", "lg");
  right.style.marginLeft = "auto";
  right.append(el("span", ATLAS.source ? "warn" : null, srcBadgeText()));
  w.append(right);
}

/**
 * The sidebar's own filter box.
 *
 * It lives here rather than with the dock controls because it belongs to the
 * list it filters. Debounced, because every keystroke otherwise repaints the
 * whole map — it narrows what is drawn, it does not select anything.
 */
let queryTimer = null;
function initSidebarFilter() {
  $("#q").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => { S.query = v; staticDirty = true; }, 120);
  });
}
