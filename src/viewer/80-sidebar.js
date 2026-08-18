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
    const all = el("button", "row flow" + (S.activeFlow === "__all__" ? " sel" : ""));
    all.append(el("span", "mk", "▶"), el("span", "nm", "all paths"),
      el("span", "num", fs.reduce((a, f) => a + f.steps.length, 0) + " steps"));
    all.onclick = () => { S.activeFlow = "__all__"; relayout(); renderList(); fitView(); renderCaption(); };
    wrap.append(all);
    for (const f of fs) {
      // A real <button>: it acts like one, so it should be one — focusable,
      // keyboard-reachable, and announced as a control rather than as text.
      const r = el("button", "row flow" + (S.activeFlow === f.id ? " sel" : ""));
      r.dataset.flow = f.id;
      r.append(el("span", "mk", "▶"), el("span", "nm", f.label), el("span", "num", f.steps.length));
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
    // The district's two-character code, tinted with its layer's identity
    // colour. In `mono` the tint drops out and the code still names it — which
    // is the point of shipping a code at all rather than relying on the swatch.
    const cd = el("span", "cd", d.code ?? "");
    if (S.colorMode === "identity") cd.style.borderColor = layerById.get(d.layer)?.color ?? THEME.layerFallback;
    r.append(cd, el("span", "nm", d.label.toLowerCase()), el("span", "num", d.members.length));
    r.onclick = () => {
      S.focusDistrict = S.focusDistrict === d.id ? null : d.id;
      S.selected = null; S.pinnedPacket = null;
      renderList(); renderInspect(); staticDirty = true;
      if (S.focusDistrict) focusOn(d);
    };
    wrap.append(r);
  }
}

/**
 * Services, each one a disclosure holding its own districts.
 *
 * A flat checkbox list makes every service cost the same amount of vertical
 * space whether or not you are looking at it, which on a seven-service repo
 * pushes everything else off the panel. Collapsed, a service is one line and
 * its own count; open, it is the districts it actually contains — the same
 * grouping the map draws, so the panel and the map agree about what a service
 * IS. Ordered by `order`, which is the order the map lays them out in; the
 * payload's own array order is not that, and a sidebar that disagrees with the
 * picture is worse than one that says less.
 */
function renderServices() {
  const w = $("#svc"); w.innerHTML = "";
  const services = ATLAS.services.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  for (const s of services) {
    const files = ATLAS.nodes.filter((x) => x.service === s.id && x.kind === "file");
    if (!files.length) continue;

    const det = el("details", "svc");
    if (S.openServices.has(s.id)) det.open = true;
    det.ontoggle = () => det.open ? S.openServices.add(s.id) : S.openServices.delete(s.id);

    const sum = el("summary");
    // The checkbox lives in the summary so a service can be switched off
    // without opening it; stopping the click keeps that from also toggling
    // the disclosure, which would make one gesture do two things.
    const cb = el("input"); cb.type = "checkbox"; cb.checked = S.services.has(s.id);
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => {
      cb.checked ? S.services.add(s.id) : S.services.delete(s.id);
      relayout(); renderList(); fitView();
    };
    sum.append(cb, el("span", "nm", s.label), el("span", "num", files.length));
    det.append(sum);

    const inner = el("div", "svcBody");
    const districts = [...new Set(files.map((f) => f.layer))]
      .sort((a, b) => (layerById.get(a)?.rank ?? 99) - (layerById.get(b)?.rank ?? 99));
    for (const L of districts) {
      const members = files.filter((f) => f.layer === L);
      const id = `${s.id}|${L}`;
      const r = el("div", "row mini" + (S.focusDistrict === id ? " sel" : ""));
      const cd = el("span", "cd", codeByGroup.get(id) ?? "");
      if (S.colorMode === "identity") cd.style.borderColor = layerById.get(L)?.color ?? THEME.layerFallback;
      r.append(cd, el("span", "nm", (layerById.get(L)?.label ?? L).toLowerCase()), el("span", "num", members.length));
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
  $("#bRef").textContent = `${m.ref} @ ${m.commit} · ${m.generatedAt}`;
  const rows = viewKind(S.view) === "tests"
    ? [
        ["TEST FILES", fmt(m.testCount)], ["SUITES", fmt(m.suiteCount)],
        ["DIRECT", fmt(m.coverDirect)], ["INDIRECT", fmt(m.coverIndirect)],
        ["NO TEST REACHES", fmt(m.coverNone)], ["LINKS", fmt(m.edgeCount)],
      ]
    : [
        // The tool's central caveat leads the strip rather than trailing it:
        // hops nothing observed, files no rule recognised. The row clips what
        // does not fit, and a clipped caveat is not a caveat — so it outranks
        // every count beside it. It took the package count's slot, whose only
        // real use is the per-node list INSPECT already shows.
        ["DERIVED · UNMAPPED", `${fmt(m.derivedCount)} · ${fmt(m.unsortedCount)}`],
        ["NODES", fmt(m.nodeCount)], ["SOURCE FILES", fmt(m.fileCount)], ["LINES", fmt(m.lineCount)],
        ["LINKS", fmt(m.edgeCount)], ["ENDPOINTS", fmt(m.endpointCount)], ["TESTS", fmt(m.testCount)],
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

