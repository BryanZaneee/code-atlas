/* Findings, drawn on the city: highlighted in place (moving the blocks would delete the answer to "where is this"), severity spelled out as well as coloured, and muted findings shown under their own heading rather than hidden. */

const FINDINGS = ATLAS.findings ?? [];
const findingById = new Map(FINDINGS.map((f) => [f.id, f]));

/** Severity, in the two non-colour channels: a chip code and a spoken word. */
const SEV_CODE = { error: "ERR", warning: "WRN", info: "INF" };
const SEV_WORD = { error: "ERROR", warning: "WARNING", info: "INFO" };
const SEV_RANK = ["error", "warning", "info"];

/** A floor on the framed extent, in world units at 1:1, so a single block cannot fill the screen and lose the place it sits in. */
const FIND_FRAME_MIN = 900;

/** The severity colour, from the payload theme — canvas cannot read a CSS var. */
function findColor(f) {
  return THEME.findingSeverity?.[f?.severity] ?? THEME.accent;
}

/** The selected finding, or null, including when the view is not findings, so no caller has to check that. */
function findSelected() {
  if (viewKind(S.view) !== "findings") return null;
  return findingById.get(S.finding) ?? null;
}

/** Every node one finding implicates: its evidence nodes and both ends of its evidence edges. */
function findNodeIds(f) {
  const ids = new Set(f?.evidence?.nodes ?? []);
  for (const e of f?.evidence?.edges ?? []) { ids.add(e.from); ids.add(e.to); }
  return ids;
}

/** The same set for `visibleSet()`, or null when nothing is selected. */
function findEvidenceIds() {
  const f = findSelected();
  return f ? findNodeIds(f) : null;
}

/** The evidence blocks that are actually on the map, with geometry to draw. */
function findBlocks(f) {
  const out = [];
  for (const id of findNodeIds(f)) {
    const n = byId.get(id);
    if (n && LAYOUT.ids.has(id) && n.faces) out.push(n);
  }
  return out;
}

/* ── the highlight ────────────────────────────────────────────── */

let findVeil = 0;

/** Eased, not cut, and driven from `frame()` so it shares one clock with everything else that moves. */
function easeFindings(dt) {
  const target = findSelected() ? 0.84 : 0;
  findVeil += (target - findVeil) * Math.min(1, dt * 7);
}

/** One fillRect over the blitted city plus a repaint of the few blocks that matter, never a second raster. */
function drawFindings() {
  if (findVeil < 0.02) return;
  const f = findSelected();

  ctx.save();
  ctx.globalAlpha = findVeil;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.setTransform(DPR * S.zoom, 0, 0, DPR * S.zoom, DPR * S.panX, DPR * S.panY);
  ctx.globalAlpha = findVeil * 0.8;
  drawGrid(ctx, cacheExtent(), (v) => v / S.zoom);
  ctx.restore();

  if (!f) { ctx.restore(); return; }

  const col = findColor(f);
  const blocks = findBlocks(f);
  const dash = f.muted ? [5, 4] : null;

  for (const n of blocks) drawBlock(ctx, n, toScreen, 1);

  // The ground ring is what makes a one-storey file as findable as a tower.
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  for (const n of blocks) {
    ctx.globalAlpha = f.muted ? 0.16 : 0.3;
    quad(ctx, footprintOf(n).map(toScreen), col, null, 0);
    ctx.globalAlpha = 1;
    quad(ctx, silhouetteOf(n).map(toScreen), null, col, f.muted ? 1.2 : 2);
  }
  ctx.restore();

  // Direction is the finding: without arrowheads a cycle is just three lit blocks.
  for (const e of f.evidence?.edges ?? []) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a?.top || !b?.top || !LAYOUT.ids.has(e.from) || !LAYOUT.ids.has(e.to)) continue;
    const arc = findArc(a.top, b.top);
    drawArc(ctx, arc, { c: col, w: f.muted ? 1.4 : 2.4, dash }, 1);
    findArrow(arc, col);
  }

  // Names are capped: a forty-file cycle turns to mush, and the panel lists them all anyway.
  if (blocks.length <= 12) {
    ctx.save();
    for (const n of blocks) chip(ctx, toScreen(n.top), n.name, col);
    ctx.restore();
  }

  ctx.restore();
}

/** Bows sideways, not upward like `arcFor`: A→B and B→A would otherwise draw the same curve and a two-file cycle would read as one line. */
function findArc(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = 22 + dist * 0.2;
  return { a, b, dist, cx: (a.x + b.x) / 2 - (dy / dist) * bow, cy: (a.y + b.y) / 2 + (dx / dist) * bow };
}

/** A head partway along the arc rather than at its end, where a block would cover it. */
function findArrow(arc, col) {
  const p = toScreen(bez(arc, 0.56)), q = toScreen(bez(arc, 0.66));
  const a = Math.atan2(q.y - p.y, q.x - p.x);
  const r = clamp(8 * S.zoom, 5, 11);
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(q.x, q.y);
  ctx.lineTo(q.x - Math.cos(a - 0.42) * r, q.y - Math.sin(a - 0.42) * r);
  ctx.lineTo(q.x - Math.cos(a + 0.42) * r, q.y - Math.sin(a + 0.42) * r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Frame the evidence with the city still around it; unlike `focusOn`, the claim is about where this sits, so the neighbours stay in shot. */
function findFocus(f) {
  const b = bboxOf(findBlocks(f));
  if (!Number.isFinite(b.x0)) return;
  const padX = Math.max(0, FIND_FRAME_MIN - (b.x1 - b.x0)) / 2;
  const padY = Math.max(0, FIND_FRAME_MIN - (b.y1 - b.y0)) / 2;
  fitBox({ x0: b.x0 - padX, x1: b.x1 + padX, y0: b.y0 - padY, y1: b.y1 + padY }, 0.8);
}

/** Pick a finding, or unpick the lit one. `relayout()` rather than a repaint, because a filtered-out evidence block is put back by `visibleSet()`. */
function selectFinding(id) {
  S.finding = S.finding === id ? null : id;
  S.selected = null;
  S.pinnedPacket = null;
  relayout();
  renderList();
  renderInspect();
  const f = findSelected();
  if (f) findFocus(f); else fitView();
}

/* ── the list ─────────────────────────────────────────────────── */

/** Grouped the way `src/cli/report.mjs` groups it, so two readings of the same data do not disagree about its shape. */
function findGroups() {
  const groups = new Map();
  const muted = [];
  for (const f of FINDINGS) {
    if (f.muted) { muted.push(f); continue; }
    if (!groups.has(f.type)) groups.set(f.type, []);
    groups.get(f.type).push(f);
  }
  const out = [...groups].map(([label, items]) => ({ label, items, muted: false }));
  if (muted.length) out.push({ label: "muted", items: muted, muted: true });
  return out;
}

/** `2 error · 5 warning · 1 muted` — the CLI's severity tally, in one line. */
function findTally() {
  const active = FINDINGS.filter((f) => !f.muted);
  const parts = SEV_RANK
    .map((sev) => [sev, active.filter((f) => f.severity === sev).length])
    .filter(([, n]) => n > 0)
    .map(([sev, n]) => `${n} ${sev}`);
  const muted = FINDINGS.length - active.length;
  if (muted) parts.push(`${muted} muted`);
  return parts.join(" · ");
}

function renderFindingList(wrap, title, count) {
  title.textContent = "FINDINGS";
  count.textContent = FINDINGS.filter((f) => !f.muted).length;

  if (!FINDINGS.length) {
    // The empty state names which checks ran: "not measured" and "nothing found" are different claims.
    wrap.append(el("div", "hint",
      "Nothing to report. All eight structural checks ran over this map and none of them matched — no cycles, no layering violations, no orphans, no oversized files."));
    wrap.append(el("div", "hint",
      "Two of the checks stay silent when their basis is not measured rather than reporting a clean result: untested endpoints need tests this scan could resolve, and unreachability needs an entrypoint to measure from."));
    return;
  }

  wrap.append(el("div", "hint", findTally()));

  for (const g of findGroups()) {
    const h = el("div", "hint grp", `${g.label.toUpperCase()} (${g.items.length})`);
    wrap.append(h);
    for (const f of g.items) {
      // A real <button>, so it is focusable, keyboard-reachable and announced as a control.
      const r = el("button", "row fnd" + (S.finding === f.id ? " sel" : "") + (f.muted ? " mute" : ""));
      r.dataset.finding = f.id;
      // An attribute, never markup: `message` is built from repository paths.
      r.title = `${f.message}\n\n${f.why}`;
      r.append(
        el("span", "sev sev-" + f.severity, SEV_CODE[f.severity] ?? "?"),
        el("span", "nm", f.message),
        el("span", "num", String(f.evidence?.nodes?.length ?? 0)),
      );
      r.onclick = () => selectFinding(f.id);
      wrap.append(r);
    }
  }
}

/* ── the panel ────────────────────────────────────────────────── */

/** Opens an import-shaped finding at its edge's line and a file-shaped one at the file; a finding with no line gets no button rather than an invented one. */
function findJump(f) {
  for (const e of f.evidence?.edges ?? []) {
    const real = (edgesFrom.get(e.from) ?? []).find((x) => x.to === e.to && x.line);
    if (real) return srcJump("⤷ IMPORT IN", real.from, real.line);
  }
  for (const id of f.evidence?.nodes ?? []) {
    const n = byId.get(id);
    if (n?.kind === "endpoint") {
      const ep = srcEndpoint(id);
      if (ep) return srcJump("⤷ ROUTE IN", ep.definedIn, ep.line);
    }
    if (n?.kind === "file") return srcJump("⤷ READ", id, 0);
  }
  return null;
}

function renderFinding(b, f) {
  const ev = f.evidence ?? { nodes: [], edges: [] };

  b.append(el("div", "eyebrow", SEV_WORD[f.severity] ?? String(f.severity).toUpperCase()));
  b.append(el("div", "title", f.type));
  b.append(el("div", "meta", `${ev.nodes.length} block${ev.nodes.length === 1 ? "" : "s"} · ${ev.edges.length} edge${ev.edges.length === 1 ? "" : "s"}`));
  // The id is the string `findings.mute` names, so it is quotable from here and not only from the CLI.
  b.append(el("div", "path", f.id));

  const note = el("div", "note" + (f.severity === "error" ? " warn" : ""));
  note.append(el("div", null, f.message));
  note.append(el("div", "why", f.why));
  b.append(note);

  if (f.muted) {
    b.append(el("div", "note",
      `MUTED — ${f.muteReason}. Config silences this finding; it is still found, still counted and still drawn.`));
  }

  const jump = findJump(f);
  if (jump) b.append(jump);

  if (ev.nodes.length) {
    b.append(el("h3", null, `EVIDENCE (${ev.nodes.length})`));
    for (const id of ev.nodes) {
      const n = byId.get(id);
      const r = el("div", "row mini");
      // A filtered-out node is named and marked rather than dropped: the finding is about it either way.
      r.append(el("span", "nm", n?.name ?? id), el("span", "sub", n ? n.kind : "not in this scan"));
      r.onclick = () => { S.selected = id; renderInspect(); };
      b.append(r);
    }
  }

  if (ev.edges.length) {
    b.append(el("h3", null, `IMPLICATED EDGES (${ev.edges.length})`));
    for (const e of ev.edges.slice(0, 40)) {
      const r = el("div", "row mini");
      const from = byId.get(e.from)?.name ?? e.from;
      const to = byId.get(e.to)?.name ?? e.to;
      r.append(el("span", "nm", `${from} → ${to}`), el("span", "sub", e.kind));
      const real = (edgesFrom.get(e.from) ?? []).find((x) => x.to === e.to && x.line);
      const line = real && srcJump(null, real.from, real.line);
      if (line) r.append(line);
      r.onclick = () => { S.selected = e.from; renderInspect(); };
      b.append(r);
    }
    if (ev.edges.length > 40) b.append(el("div", "hint", `+${ev.edges.length - 40} more`));
  }
}
