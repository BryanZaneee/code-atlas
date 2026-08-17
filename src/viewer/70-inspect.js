/* ════════════════════ inspect panel ════════════════════ */
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c])); }

function selectStep(st) {
  S.pinnedPacket = st;
  S.selected = st.to;
  renderInspect();
  staticDirty = true;
}

function renderInspect() {
  const b = $("#insBody");
  b.innerHTML = "";

  if (S.pinnedPacket) {
    const st = S.pinnedPacket;
    const f = flowById.get(st.flowId);
    b.append(el("div", "title", st.label || "packet"));
    b.append(el("div", "path", `${f ? f.label + " · " : ""}step ${st.i + 1}`));
    const dl = el("dl", "kv");
    const add = (k, v) => { dl.append(el("dt", null, k), el("dd", null, v)); };
    add("KIND", st.kind);
    add("FROM", byId.get(st.from)?.name ?? st.from);
    add("TO", byId.get(st.to)?.name ?? st.to);
    b.append(dl);
    if (st.note) b.append(el("div", "note" + (st.warn ? " warn" : ""), st.note));
    if (st.sample) {
      b.append(el("h3", null, "PACKET PAYLOAD (SYNTHETIC)"));
      const pre = el("pre", "sample", JSON.stringify(st.sample, null, 2));
      b.append(pre);
    }
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
      b.append(el("div", "path", `${d.label.toLowerCase()} · ${d.members.length} files`));
      const dl = el("dl", "kv");
      dl.append(el("dt", null, "LINES"), el("dd", null, fmt(d.members.reduce((a, n) => a + n.loc, 0))));
      b.append(dl);
      b.append(el("h3", null, "FILES"));
      for (const n of d.members.slice().sort((a, x) => x.loc - a.loc)) {
        const r = el("div", "row mini");
        r.append(el("span", "nm", n.name), el("span", "num", `${n.loc}L`));
        r.onclick = () => { S.selected = n.id; renderInspect(); staticDirty = true; };
        b.append(r);
      }
      return;
    }
  }

  const n = byId.get(S.selected);
  if (!n) {
    b.append(el("div", "hint", "Choose a block in the map, a district on the left, or click a moving packet. The packets follow real relationships — imports in STRUCTURE, real call order in the flow views."));
    return;
  }

  b.append(el("div", "title", n.name));
  b.append(el("div", "path", n.id));
  const dl = el("dl", "kv");
  const add = (k, v) => { dl.append(el("dt", null, k), el("dd", null, v)); };
  add("SERVICE", svcById.get(n.service)?.label ?? n.service);
  add("LAYER", layerById.get(n.layer)?.label ?? n.layer);
  if (n.kind === "file") {
    add("LINES", fmt(n.loc));
    add("EXPORTS", n.exports);
  }
  add("KIND", n.kind);
  add("IN / OUT", `${n.inDeg} in · ${n.outDeg} out`);
  if (n.testKind) add("SUITE", n.testKind);
  if (n.subject) add("COVERS", byId.get(n.subject)?.name ?? n.subject);
  b.append(dl);

  if (n.note) b.append(el("div", "note", n.note));
  if (n.coverage) {
    const txt = {
      direct: "A test file imports this module directly.",
      indirect: "No test imports this module, but it is reachable through the import graph from one that is tested — a route file reached through an app factory lands here.",
      none: "Not reachable from any test file through imports. The repo has no coverage tooling, so this is derived from test imports plus the test↔source naming convention, not from execution.",
    }[n.coverage];
    b.append(el("div", "note" + (n.coverage === "none" ? " warn" : ""), `COVERAGE: ${n.coverage.toUpperCase()} — ${txt}`));
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
      r.onclick = () => { S.selected = e[key]; S.pinnedPacket = null; renderInspect(); staticDirty = true; };
      b.append(r);
      if (e.note) b.append(el("div", "note warn", e.note));
    }
  };
  list("IMPORTS / CALLS", outs, "to");
  list("USED BY", ins, "from");
}

