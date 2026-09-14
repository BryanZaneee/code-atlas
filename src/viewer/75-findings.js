/* ════════════════════ findings ════════════════════
 *
 * What the tool says about the code, drawn ON the code.
 *
 * `atlas findings` prints the same eight checks as a list; a list is where a
 * cycle stops being legible. Three files that import each other in a ring is a
 * shape, and the map already knows where those three files are — so the finding
 * is a highlight over the city rather than a second picture of it.
 *
 * Three rules shape everything below.
 *
 * IN PLACE. Selecting a finding veils the map and repaints the blocks and edges
 * it names at full strength. It does not re-pack the layout into an isolated
 * view the way a flow does: a flow answers "what is this path", and moving the
 * blocks is how it answers; a finding answers "where is this problem", and
 * moving the blocks would delete the answer. The rest of the city stays exactly
 * where it was, dimmed — CLAUDE.md names the blank screen as the prototype's
 * worst failure, and a highlight that empties the map is a blank screen with
 * extra steps.
 *
 * SEVERITY IN WORDS, NOT ONLY IN COLOUR. Every row carries a three-letter code,
 * every panel spells the severity out, and the legend declares that the colour
 * means the same thing. Colour is the fast channel, not the only one.
 *
 * MUTED IS SHOWN, NOT HIDDEN. The engine deliberately keeps muted findings in
 * the payload so silencing one stays a visible fact (docs/payload-schema.md,
 * "Muting never removes a finding"). This view must not undo that: a muted
 * finding is listed under its own heading, still counted, still selectable, and
 * drawn with a dashed ring that says silenced rather than absent.
 */

const FINDINGS = ATLAS.findings ?? [];
const findingById = new Map(FINDINGS.map((f) => [f.id, f]));

/** Severity, in the two non-colour channels: a chip code and a spoken word. */
const SEV_CODE = { error: "ERR", warning: "WRN", info: "INF" };
const SEV_WORD = { error: "ERROR", warning: "WARNING", info: "INFO" };
const SEV_RANK = ["error", "warning", "info"];

/**
 * A single implicated block must not fill the screen: the whole point of
 * highlighting in place is the place, and a frame tight enough to lose the
 * surrounding districts has thrown it away. In world units at 1:1.
 */
const FIND_FRAME_MIN = 900;

/** The severity colour, from the payload theme — canvas cannot read a CSS var. */
function findColor(f) {
  return THEME.findingSeverity?.[f?.severity] ?? THEME.accent;
}

/**
 * The selected finding, or null — including when the view is not the findings
 * view, so nothing else has to remember to check that.
 */
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

/**
 * Eased rather than cut, for the reason the flow trace is: the transition is
 * what says the map changed rather than reloaded. Driven from `frame()`, so it
 * shares one clock with everything else that moves.
 */
function easeFindings(dt) {
  const target = findSelected() ? 0.84 : 0;
  findVeil += (target - findVeil) * Math.min(1, dt * 7);
}

/**
 * The veil, and what stands out of it.
 *
 * Same technique as `drawTrace`: one fillRect over the blitted city plus a
 * repaint of the few blocks that matter, rather than a second raster. The grid
 * comes back at nearly full strength so the ground survives and the highlight
 * still reads as somewhere.
 */
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

  // Ground ring first, then silhouette: the top face is a third of a tall
  // block and much less of a short one, so the ring is what makes a
  // one-storey file as findable as a tower.
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  for (const n of blocks) {
    ctx.globalAlpha = f.muted ? 0.16 : 0.3;
    quad(ctx, footprintOf(n).map(toScreen), col, null, 0);
    ctx.globalAlpha = 1;
    quad(ctx, silhouetteOf(n).map(toScreen), null, col, f.muted ? 1.2 : 2);
  }
  ctx.restore();

  // The edges the finding names, with their direction. A cycle is a ring of
  // arrows or it is just three lit blocks — direction IS the finding.
  for (const e of f.evidence?.edges ?? []) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a?.top || !b?.top || !LAYOUT.ids.has(e.from) || !LAYOUT.ids.has(e.to)) continue;
    const arc = findArc(a.top, b.top);
    drawArc(ctx, arc, { c: col, w: f.muted ? 1.4 : 2.4, dash }, 1);
    findArrow(arc, col);
  }

  // Names, capped. A four-file cycle reads much better labelled; a forty-file
  // one turns to mush, and the panel lists them all anyway.
  if (blocks.length <= 12) {
    ctx.save();
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "center";
    for (const n of blocks) {
      const s = toScreen(n.top);
      const w = ctx.measureText(n.name).width;
      ctx.fillStyle = col;
      ctx.fillRect(s.x - w / 2 - 5, s.y - 28, w + 10, 15);
      ctx.fillStyle = BG;
      ctx.fillText(n.name, s.x, s.y - 17);
    }
    ctx.restore();
  }

  ctx.restore();
}

/**
 * An arc that bows SIDEWAYS rather than upward.
 *
 * `arcFor` lifts its control point straight up from the midpoint, which is
 * right for a packet route and wrong here: A→B and B→A then produce the same
 * curve, so the two hops of a two-file cycle draw exactly on top of each other
 * and the ring the finding is about reads as a single line. Bowing along the
 * perpendicular makes the reversal fall out of the geometry — flip `a` and `b`
 * and the offset flips with them — so a cycle opens into the lens that says a
 * cycle, at any camera angle, with nothing to keep in step by hand.
 */
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

/**
 * Frame the evidence with the city still around it.
 *
 * `focusOn` exists for districts and pulls in tight, which is right when you
 * asked for one district and wrong here: the finding's claim is about where in
 * the system this sits, so the frame has to keep the neighbours in shot.
 */
function findFocus(f) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const n of findBlocks(f)) {
    for (const face of n.faces) {
      for (const p of face.pts) {
        if (p.x < b.x0) b.x0 = p.x;
        if (p.x > b.x1) b.x1 = p.x;
        if (p.y < b.y0) b.y0 = p.y;
        if (p.y > b.y1) b.y1 = p.y;
      }
    }
  }
  if (!Number.isFinite(b.x0)) return;
  const padX = Math.max(0, FIND_FRAME_MIN - (b.x1 - b.x0)) / 2;
  const padY = Math.max(0, FIND_FRAME_MIN - (b.y1 - b.y0)) / 2;
  fitBox({ x0: b.x0 - padX, x1: b.x1 + padX, y0: b.y0 - padY, y1: b.y1 + padY }, 0.8);
}

/**
 * Pick a finding, or unpick the one already lit.
 *
 * `relayout()` rather than a repaint: the evidence may name a block a sidebar
 * filter had removed, and `visibleSet()` is where that gets put back.
 */
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

/**
 * Grouped the way `src/cli/report.mjs` groups it: by type, in the payload's own
 * order, with the muted ones under their own heading at the end. Two readings
 * of the same data should not disagree about its shape.
 */
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
    // The empty state is a result, not an absence. It says which checks ran and
    // which of them are silent for a reason other than a clean repository —
    // "not measured" and "nothing found" are different claims, and the honesty
    // contract is the reason this view refuses to blur them.
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
      // A real <button>, like the flow rows: it behaves as one, so it is one —
      // focusable, keyboard-reachable, announced as a control.
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

/**
 * The file a finding is about, opened at the line that matters.
 *
 * An import-shaped finding (layering, cross-service, a cycle) has a real edge
 * behind it carrying the line its import is written on, so that is what opens.
 * A file-shaped one opens the file. Nothing is invented: a finding with no
 * line to point at gets no button, exactly as an inferred hop does.
 */
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
  // The id is the string a config's `findings.mute` names, so it is quotable
  // from here rather than only from the CLI.
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
      // A node the current filters removed is named and marked rather than
      // dropped: the finding is about it either way.
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
