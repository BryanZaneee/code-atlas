/* ════════════════════ sidebar ════════════════════ */
function renderViews() {
  const w = $("#views"); w.innerHTML = "";
  for (const v of VIEWS) {
    const btn = el("button", S.view === v.id ? "on" : null, v.label);
    btn.onclick = () => setView(v.id);
    w.append(btn);
  }
}

const SIDE_HINT = {
  structure: "Rows are services, columns are the router → controller → service → repository layers AGENTS.md rule 10 mandates. Building height is file length. Click a district to open it and list its files.",
  api: "Each entry is one endpoint's real call chain. Packets carry a synthetic payload — click one to read the note attached to that hop.",
  engagement: "The cross-service document trace, in three phases. STEP walks it one hop at a time. The dashed red edges are the two places the OCR service touches Core's tables directly instead of calling its API.",
  tests: "Thick edges are a test's primary subject, thin dashed ones are everything else it exercises. Orange blocks have no test referencing them.",
};

function renderList() {
  const wrap = $("#list"); wrap.innerHTML = "";
  const title = $("#listTitle"), count = $("#listCount");

  if (S.view === "api" || S.view === "engagement") {
    title.textContent = S.view === "api" ? "ENDPOINTS" : "PHASES";
    const fs = flowsForView(S.view);
    count.textContent = fs.length;
    const all = el("div", "row" + (S.activeFlow === "__all__" ? " sel" : ""));
    all.append(el("span", "sw"), el("span", "nm", "▸ ALL"), el("span", "num", fs.reduce((a, f) => a + f.steps.length, 0) + " steps"));
    all.querySelector(".sw").style.background = "transparent";
    all.onclick = () => { S.activeFlow = "__all__"; relayout(); renderList(); fitView(); };
    wrap.append(all);
    for (const f of fs) {
      const r = el("div", "row" + (S.activeFlow === f.id ? " sel" : ""));
      const sw = el("span", "sw"); sw.style.background = "#8a3a2a";
      r.append(sw, el("span", "nm", f.label), el("span", "num", f.steps.length));
      r.onclick = () => { S.activeFlow = f.id; S.pinnedPacket = null; relayout(); renderList(); fitView(); renderInspect(); };
      wrap.append(r);
      if (S.activeFlow === f.id && f.blurb) wrap.append(el("div", "hint", f.blurb));
    }
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
    const sw = el("span", "sw"); sw.style.background = layerById.get(d.layer)?.color ?? "#888";
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
  const rows = S.view === "tests"
    ? [
        ["TEST FILES", fmt(m.testCount)], ["SUITES", "4"],
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
  const items = S.view === "tests"
    ? [
        ["i", "#a8542f", "TEST COVERS (PRIMARY SUBJECT)", false],
        ["i", "#a8542f", "ALSO EXERCISES", true],
        ["u", "#7e9a8a", "DIRECT — A TEST IMPORTS IT", false],
        ["u", "#a89a5c", "INDIRECT — REACHED VIA IMPORTS", false],
        ["u", "#b0562f", "NONE — NO TEST REACHES IT", false],
      ]
    : [
        ["i", "#6f7358", "IMPORT", false],
        ["i", "#8a3a2a", "CROSS-SERVICE HTTP", false],
        ["i", "#8a3a2a", "SHARED-DB COUPLING", true],
        ["i", "#3f6a7a", "SQL / CACHE", false],
        ["u", "#2f4a1f", "PACKET — CLICK TO INSPECT", false],
      ];
  const w = $("#legend"); w.innerHTML = "";
  for (const [tag, c, label, dash] of items) {
    const g = el("div", "lg");
    const mark = el(tag);
    if (tag === "i") { mark.style.borderTopColor = c; if (dash) mark.className = "dash"; }
    else mark.style.background = c;
    g.append(mark, el("span", null, label));
    w.append(g);
  }
  const right = el("div", "lg");
  right.style.marginLeft = "auto";
  right.append(el("span", null, "READ-ONLY PROJECTION · NO SOURCE EMBEDDED"));
  w.append(right);
}

