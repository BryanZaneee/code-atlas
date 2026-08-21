/* ════════════════════ render ════════════════════ */
const cv = $("#cv"), ctx = cv.getContext("2d");
const off = document.createElement("canvas"), octx = off.getContext("2d");
let staticDirty = true, W = 0, H = 0, DPR = 1;

/** The static layer caches in WORLD space, so a pan is a blit offset rather than a full re-raster; zoom re-renders only when it crosses a mip bucket. */
const CACHE = { key: "", scale: 0, x0: 0, y0: 0, w: 1, h: 1 };
const MAX_CACHE_SIDE = 8192;   // hard limit on the backing store, per side
// Area budget too: the per-side limit alone permits a 268 MB store, which is a failed allocation on a small machine.
const MAX_CACHE_PIXELS = ((globalThis.navigator?.deviceMemory ?? 8) >= 8 ? 32 : 8) * 1e6;
// Slack for labels and plate tabs, drawn in screen px and so covering more world px the further out you are.
const CACHE_PAD = 220;         // world px at 1:1, scaled below

/** Third-octave buckets: a re-render every ~26% of zoom, not every frame. */
const mipScale = (zoom) => Math.pow(2, Math.round(Math.log2(zoom) * 3) / 3);

function resize() {
  DPR = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = Math.max(1, Math.round(W * DPR));
  cv.height = Math.max(1, Math.round(H * DPR));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/** Everything that changes what the static layer looks like, but not where it sits. */
function cacheKey() {
  const o = S.opts;
  // Selection and hover are deliberately absent: they belong to the live pass, or a click would re-raster the whole city.
  return [
    S.view, S.query, S.focusDistrict, S.yaw, S.colorMode, S.isolate,
    S.shape, S.packing, S.density, S.ground, LAYOUT.nodes.length, layoutEpoch,
    o.docs, o.tests, o.contract, o.labels,
  ].join("|");
}

function quad(x, pts, fill, stroke, lw) {
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  x.closePath();
  if (fill) { x.fillStyle = fill; x.fill(); }
  if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw; x.stroke(); }
}

const same = (p) => p;

/** One block, in whatever space `map` puts it — world for the raster, screen for the overlay. */
function drawBlock(x, n, map, lw) {
  const base = colorOf(n);
  // reproject() already ordered and culled the faces, so this draws any shape without knowing which.
  for (const f of n.faces) {
    quad(x, f.pts.map(map), shade(base, f.shade), alpha(THEME.edge, f.cap ? .58 : .45), lw);
  }
}

function dimOf(n) {
  if (S.query) {
    const q = S.query.toLowerCase();
    if (!n.id.toLowerCase().includes(q) && !(n.name ?? "").toLowerCase().includes(q)) return true;
  }
  if (S.focusDistrict && districtId(n.service, n.layer) !== S.focusDistrict) return true;
  return false;
}

/** The plate corner `better` prefers; which corner is nearest or leftmost depends on yaw, so it cannot be pinned. */
function cornerOf(p, better) {
  let best = null;
  for (const [gx, gy] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
    const q = project(gx, gy, 0);
    if (!best || better(q, best)) best = q;
  }
  return best;
}

/** A label on a leader line back to the corner it names, so it cannot drift into the blocks when the layout changes. */
function tab(x, at, dx, dy, text, px) {
  x.save();
  x.globalAlpha = 0.55;
  x.strokeStyle = x.fillStyle;
  x.lineWidth = px(1);
  x.beginPath();
  x.moveTo(at.x, at.y);
  x.lineTo(at.x + dx, at.y + dy);
  x.stroke();
  x.restore();
  x.fillText(text, at.x + dx + (dx < 0 ? -px(3) : px(3)), at.y + dy + (dy > 0 ? px(3) : 0));
}

/** The ground plane: the only depth cue a flat-shaded axonometric view has, stepped by the layout's own grid unit so lines run through block origins. */
function drawGrid(x, ext, px) {
  if (!S.ground || !LAYOUT.servicePlates.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of LAYOUT.servicePlates) {
    if (p.x0 < x0) x0 = p.x0;
    if (p.y0 < y0) y0 = p.y0;
    if (p.x1 > x1) x1 = p.x1;
    if (p.y1 > y1) y1 = p.y1;
  }
  const pad = SPACING * 3;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;

  x.save();
  // Faint on purpose; the order that must hold, lightest first, is grid << plate < block fill < block stroke.
  x.strokeStyle = alpha(THEME.plate, .11);
  x.lineWidth = px(1);
  x.beginPath();
  for (let g = x0; g <= x1; g += SPACING) {
    const a = project(g, y0, 0), b = project(g, y1, 0);
    x.moveTo(a.x, a.y); x.lineTo(b.x, b.y);
  }
  for (let g = y0; g <= y1; g += SPACING) {
    const a = project(x0, g, 0), b = project(x1, g, 0);
    x.moveTo(a.x, a.y); x.lineTo(b.x, b.y);
  }
  x.stroke();

  // Fade to the ground colour at the edges, so the grid never announces where the layout happens to stop.
  const c = project((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const r = Math.max(ext.w, ext.h) / 2;
  const fade = x.createRadialGradient(c.x, c.y, r * 0.25, c.x, c.y, r);
  fade.addColorStop(0, alpha(BG, 0));
  fade.addColorStop(1, alpha(BG, 1));
  x.fillStyle = fade;
  x.fillRect(ext.x0, ext.y0, ext.w, ext.h);
  x.restore();
}

/** World extent to cache, memoized: it moves only on relayout, rotation or a mip change, but the veil passes ask every frame. */
let extentMemo = { key: null, ext: null };
function cacheExtent() {
  const key = `${layoutEpoch}|${S.yaw}|${mipScale(S.zoom)}`;
  if (extentMemo.key === key) return extentMemo.ext;
  const ext = computeExtent();
  extentMemo = { key, ext };
  return ext;
}

function computeExtent() {
  const b = LAYOUT.bbox ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  let x0 = b.x0, y0 = b.y0, x1 = b.x1, y1 = b.y1;
  for (const p of LAYOUT.servicePlates) {
    for (const [gx, gy] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
      const q = project(gx, gy, 0);
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
  }
  const pad = CACHE_PAD / Math.min(1, mipScale(S.zoom));
  return { x0: x0 - pad, y0: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

function drawStatic() {
  const ext = cacheExtent();
  // Fit the backing store to the budget: a large repo at a high zoom would ask for a canvas no browser gives.
  const wanted = mipScale(S.zoom);
  const bySide = MAX_CACHE_SIDE / (Math.max(ext.w, ext.h) * DPR);
  const byArea = Math.sqrt(MAX_CACHE_PIXELS / Math.max(1, ext.w * ext.h * DPR * DPR));
  const scale = Math.min(wanted, bySide, byArea);

  CACHE.key = cacheKey();
  CACHE.scale = wanted;
  CACHE.x0 = ext.x0; CACHE.y0 = ext.y0; CACHE.w = ext.w; CACHE.h = ext.h;

  off.width = Math.max(1, Math.round(ext.w * scale * DPR));
  off.height = Math.max(1, Math.round(ext.h * scale * DPR));
  // Draw in world coordinates from here on; the transform does the mapping.
  const m = scale * DPR;
  octx.setTransform(m, 0, 0, m, -ext.x0 * m, -ext.y0 * m);

  // Screen-space sizes divide back out, since the transform scales strokes and glyphs with the geometry.
  const px = (v) => v / scale;
  const zf = scale;                      // the zoom this raster is drawn for

  octx.fillStyle = BG;
  octx.fillRect(ext.x0, ext.y0, ext.w, ext.h);
  drawGrid(octx, ext, px);

  // service plates, then district plates
  for (const p of LAYOUT.servicePlates) {
    quad(octx, [project(p.x0, p.y0, 0), project(p.x1, p.y0, 0), project(p.x1, p.y1, 0), project(p.x0, p.y1, 0)],
      alpha(THEME.plate, .075), alpha(THEME.plate, .16), px(1));
    // Anchored to the plate's leftmost corner and leaning further left, so the service name leaves the blocks alone.
    octx.save();
    octx.fillStyle = alpha(INK, .62);
    octx.font = `600 ${px(clamp(11 * zf, 8, 15))}px ${FONT}`;
    octx.textAlign = "right";
    tab(octx, cornerOf(p, (a, b) => a.x < b.x), -px(14), 0, p.label, px);
    octx.restore();
  }
  for (const d of LAYOUT.districts) {
    const dim = S.focusDistrict && S.focusDistrict !== d.id;
    quad(octx, [project(d.x0, d.y0, 0), project(d.x1, d.y0, 0), project(d.x1, d.y1, 0), project(d.x0, d.y1, 0)],
      alpha(THEME.plate, dim ? .05 : .13), alpha(THEME.plate, .2), px(1));
    // On the nearest corner and below it: everything the district contains draws behind there, so the tab cannot be overdrawn.
    if (zf > 0.3) {
      octx.save();
      octx.fillStyle = alpha(INK, dim ? .28 : .55);
      octx.font = `${px(clamp(9 * zf, 7, 12))}px ${FONT}`;
      octx.textAlign = "left";
      tab(octx, cornerOf(d, (a, b) => a.y > b.y), px(6), px(14), `${d.code} · ${d.label.toLowerCase()}`, px);
      octx.restore();
    }
  }

  // Bucketed by style so stroke state is set once per bucket, not once per edge — the hottest loop here.
  if (!playsFlow(S.view)) {
    const buckets = new Map();
    for (const e of LAYOUT.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a?.top || !b?.top) continue;
      const faded = dimOf(a) && dimOf(b);
      const key = `${e.kind}|${faded}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { st: EDGE_STYLE[e.kind] ?? EDGE_STYLE.import, faded, pairs: [] }));
      bucket.pairs.push(a, b);
    }
    for (const { st, faded, pairs } of buckets.values()) {
      octx.save();
      octx.globalAlpha = st.a * (faded ? 0.25 : 1);
      octx.strokeStyle = st.c;
      octx.lineWidth = px(st.w);
      if (st.dash) octx.setLineDash(st.dash.map((v) => px(v * zf)));
      octx.beginPath();
      for (let i = 0; i < pairs.length; i += 2) {
        const p0 = project(pairs[i].gx + 0.5, pairs[i].gy + 0.5, 0);
        const p1 = project(pairs[i + 1].gx + 0.5, pairs[i + 1].gy + 0.5, 0);
        octx.moveTo(p0.x, p0.y);
        octx.lineTo(p1.x, p1.y);
      }
      octx.stroke();
      octx.restore();
    }
  }

  // blocks, painter's order
  const edgeStroke = px(1);
  for (const n of LAYOUT.nodes) {
    octx.globalAlpha = dimOf(n) ? 0.16 : 1;
    drawBlock(octx, n, same, edgeStroke);
  }
  octx.globalAlpha = 1;

  // Labels in a second pass, nearest first, so colliding labels drop out instead of turning to mush.
  const showLabels = S.opts.labels && zf >= 0.55;
  const size = clamp(10 * zf, 8, 13);
  const taken = [];
  const hits = (r) => taken.some(t => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
  // One measureText per distinct name rather than per node per frame.
  const widths = new Map();
  const widthOf = (name) => {
    let w = widths.get(name);
    if (w === undefined) widths.set(name, (w = octx.measureText(name).width));
    return w;
  };

  octx.save();
  octx.textAlign = "center";
  octx.lineWidth = px(3.5);
  octx.strokeStyle = alpha(BG, .92);
  octx.font = `${px(size)}px ${FONT}`;
  octx.fillStyle = alpha(INK, .92);

  // No special case for the selected node: its label is live overlay, so it survives labels being off.
  for (let i = LAYOUT.nodes.length - 1; showLabels && i >= 0; i--) {
    const n = LAYOUT.nodes[i];
    if (dimOf(n)) continue;
    const w = widthOf(n.name);
    const labelRect = { x: n.top.x - w / 2, y: n.top.y - px(5) - px(size), w, h: px(size + 3) };
    if (hits(labelRect)) continue;
    taken.push(labelRect);
    octx.strokeText(n.name, n.top.x, n.top.y - px(5));
    octx.fillText(n.name, n.top.x, n.top.y - px(5));
  }
  octx.restore();

  staticDirty = false;
}

function drawArc(x, arc, style, alpha) {
  const a = toScreen(arc.a), b = toScreen(arc.b), c = toScreen({ x: arc.cx, y: arc.cy });
  x.save();
  x.globalAlpha = alpha;
  x.strokeStyle = style.c;
  x.lineWidth = style.w * clamp(S.zoom, 0.6, 1.6);
  if (style.dash) x.setLineDash(style.dash.map(v => v * S.zoom));
  x.beginPath(); x.moveTo(a.x, a.y); x.quadraticCurveTo(c.x, c.y, b.x, b.y); x.stroke();
  x.restore();
}

/** Certainty rides on weight and dash, never colour (kind owns colour) and barely on opacity: an invisible hop would read as a path without that hop, making the map look surer than it is. */
const CERTAINTY_STYLE = {
  wired:    { wMul: 1.55, aMul: 1,    dash: null },
  imported: { wMul: 1,    aMul: 0.94, dash: null },
  inferred: { wMul: 0.7,  aMul: 0.86, dash: [2, 5] },
};

/** The same three grades in words, for the panel that has room for them. */
const CERTAINTY_LABEL = {
  wired: "wired — mount read from source",
  imported: "imported — an import edge runs this way",
  inferred: "inferred — nothing justifies this hop",
};

function stepStyle(step) {
  const base = EDGE_STYLE[step.kind] ?? EDGE_STYLE.request;
  const c = CERTAINTY_STYLE[step.certainty];
  return c ? { ...base, w: base.w * c.wMul, dash: c.dash, aMul: c.aMul } : base;
}

function drawDiamond(x, p, r, fill) {
  x.beginPath();
  x.moveTo(p.x, p.y - r); x.lineTo(p.x + r, p.y); x.lineTo(p.x, p.y + r); x.lineTo(p.x - r, p.y);
  x.closePath(); x.fillStyle = fill; x.fill();
}

/** The drop preview draws live, since a drag changes per mouse move; a refused drop is coloured, so "nothing happened" is never the whole feedback. */
function drawDragGhost() {
  const d = S.dragDistrict && LAYOUT.districts.find((x) => x.id === S.dragDistrict);
  if (!d) return;
  const { dx, dy } = S.dragCells;
  if (!dx && !dy) return;
  const off = districtOffset(d.id);
  const next = { dx: off.dx + dx, dy: off.dy + dy };
  const r = districtRectAt(d, next);
  const blocked = districtWouldOverlap(d.id, next);
  const c = blocked ? THEME.findingSeverity.error : THEME.accent;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = alpha(c, .9);
  ctx.fillStyle = alpha(c, blocked ? .1 : .07);
  ctx.beginPath();
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
    .map(([gx, gy]) => toScreen(project(gx, gy, 0)));
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Convex hull, monotone chain: total at every yaw, unlike a closed form that must case on the camera quadrant, and run only for the nodes an overlay touches. */
function hullOf(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (src) => {
    const out = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out;
  };
  return half(p).slice(0, -1).concat(half(p.reverse()).slice(0, -1));
}

/** The block's ground footprint: the widest prism in the shape, at z=0. */
function footprintOf(n) {
  const shape = SHAPES[S.shape] ?? SHAPES.block;
  const widest = shape.prisms.reduce((a, b) => (b.pts.length >= a.pts.length && b.z0 <= a.z0 ? b : a));
  return widest.pts.map(([dx, dy]) => project(n.gx + dx, n.gy + dy, 0));
}

/** The outline of what was actually drawn, taken from the face list, so the selection ring cannot drift off the shape. */
function silhouetteOf(n) {
  return hullOf(footprintOf(n).concat(n.faces.flatMap((f) => f.pts)));
}

/** The trace is a veil plus the bright blocks redrawn, not a second raster: dimming inside the static layer would re-raster every frame. */
let veil = 0;

function drawTrace() {
  if (veil < 0.02) return;
  ctx.save();
  ctx.globalAlpha = veil;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // The same grid function the raster uses, through the live transform, so the two can never disagree.
  ctx.save();
  ctx.setTransform(DPR * S.zoom, 0, 0, DPR * S.zoom, DPR * S.panX, DPR * S.panY);
  ctx.globalAlpha = veil * 0.8;
  drawGrid(ctx, cacheExtent(), (v) => v / S.zoom);
  ctx.restore();

  const lw = 1;
  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = "center";
  for (const n of LAYOUT.nodes) {
    const step = LAYOUT.steps.get(n.id);
    if (!step) continue;
    drawBlock(ctx, n, toScreen, lw);
    const s = toScreen(n.top);
    ctx.beginPath();
    ctx.arc(s.x, s.y - 13, 8, 0, 7);
    ctx.fillStyle = THEME.accent;
    ctx.fill();
    ctx.fillStyle = BG;
    ctx.fillText(step, s.x, s.y - 9.5);
  }
  ctx.restore();
}

/** Drawn after the blit, not baked into the cache: state changes per interaction, and an overlay may ignore the painter's algorithm to stay legible. */
function drawOverlay() {
  const pick = (id) => (id && LAYOUT.ids.has(id) ? byId.get(id) : null);
  const sel = pick(S.selected);
  const hov = S.hover === S.selected ? null : pick(S.hover);

  ctx.save();
  if (hov) quad(ctx, silhouetteOf(hov).map(toScreen), null, THEME.accent, 1);
  if (sel) {
    ctx.globalAlpha = 0.34;
    quad(ctx, footprintOf(sel).map(toScreen), THEME.accent, null, 0);
    ctx.globalAlpha = 1;
    quad(ctx, silhouetteOf(sel).map(toScreen), null, THEME.accent, 2);

    // A chip rather than a halo: the overlay has one solid colour nothing else on the map uses.
    const s = toScreen(sel.top);
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "center";
    const w = ctx.measureText(sel.name).width;
    ctx.fillStyle = THEME.accent;
    ctx.fillRect(s.x - w / 2 - 5, s.y - 28, w + 10, 15);
    ctx.fillStyle = BG;
    ctx.fillText(sel.name, s.x, s.y - 17);
  }
  ctx.restore();
}

let livePackets = [];   // screen-space, for hit testing

function draw() {
  // Pan never invalidates: it only moves where the cached bitmap is blitted.
  if (staticDirty || CACHE.key !== cacheKey() || CACHE.scale !== mipScale(S.zoom)) drawStatic();

  // No clearRect: BG is opaque and this fillRect covers the same area.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const o = toScreen({ x: CACHE.x0, y: CACHE.y0 });
  ctx.drawImage(off, 0, 0, off.width, off.height, o.x, o.y, CACHE.w * S.zoom, CACHE.h * S.zoom);
  drawTrace();
  // After the city, before the overlay, so the selection ring stays legible on top of a finding's veil.
  drawFindings();
  drawLive();
  drawDragGhost();
  drawOverlay();
  livePackets = [];

  // flow arcs above the city so packets are never occluded
  for (const r of runners) {
    r.steps.forEach((s, i) => {
      const cur = i === r.i;
      const st = stepStyle(s);
      drawArc(ctx, s.arc, st, (cur ? 0.85 : 0.16) * (st.aMul ?? 1));
    });
  }

  for (const p of ambient) {
    const w = bez(p.arc, p.t), s = toScreen(w);
    drawDiamond(ctx, s, clamp(2.6 * S.zoom, 1.6, 4.5), PACKET_COLOR[p.e.kind] ?? PACKET_COLOR.import);
    livePackets.push({ x:s.x, y:s.y, kind:"edge", data:p.e });
  }

  for (const r of runners) {
    const st = r.steps[r.i];
    if (!st) continue;
    const w = bez(st.arc, r.t), s = toScreen(w);
    const col = PACKET_COLOR[st.kind] ?? PACKET_COLOR.request;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    drawDiamond(ctx, s, clamp(5 * S.zoom, 3.5, 8), col);
    ctx.restore();
    ctx.strokeStyle = alpha(BG, .9); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, clamp(5 * S.zoom, 3.5, 8) + 2, 0, 7); ctx.stroke();
    livePackets.push({ x:s.x, y:s.y, kind:"step", data:st });

    if (st.label && S.zoom > 0.45) {
      ctx.save();
      ctx.font = `${clamp(9 * S.zoom, 8, 12)}px ${FONT}`;
      ctx.textAlign = "center"; ctx.lineWidth = 3;
      ctx.strokeStyle = alpha(BG, .9);
      ctx.strokeText(st.label, s.x, s.y - 13);
      ctx.fillStyle = THEME.packetLabel;
      ctx.fillText(st.label, s.x, s.y - 13);
      ctx.restore();
    }
  }

  // phase watermark, for a flow view whose flows carry phases
  if (viewById.get(S.view)?.showPhase && runners[0]?.steps[runners[0].i]) {
    const f = flowById.get(runners[0].steps[runners[0].i].flowId);
    if (f) {
      ctx.save();
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = alpha(INK, .13);
      ctx.textAlign = "right";
      ctx.fillText(f.phase ?? f.label, W - 18, H - 22);
      ctx.restore();
    }
  }
}

/** Everything a frame's appearance depends on beyond cacheKey(); comparing it to last frame is what lets a still map cost a string instead of a redraw, and both veils are in it so an ease keeps drawing. */
function frameSig() {
  const r = S.request?.live;
  return `${cacheKey()}|${W}x${H}|${S.zoom}|${S.panX}|${S.panY}|${S.selected}|${S.hover}|${S.finding}|${S.dragDistrict}|${S.dragCells.dx},${S.dragCells.dy}|${veil.toFixed(3)}|${findVeil.toFixed(3)}|${r ? `${r.status},${r.ms}` : ""}`;
}

let last = performance.now();
let lastSig = null;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Eased, not cut: the transition is what says the map changed rather than reloaded.
  const target = playsFlow(S.view) && LAYOUT.steps.size && !S.isolate ? 0.82 : 0;
  veil += (target - veil) * Math.min(1, dt * 7);
  easeFindings(dt);
  const playing = (S.running || S.stepBudget > 0) && (runners.length || ambient.length);
  if (S.running || S.stepBudget > 0) advance(dt);

  // A still map draws nothing; packet motion is the one thing frameSig cannot see, so it is asked for separately.
  const sig = frameSig();
  if (playing || staticDirty || sig !== lastSig) {
    lastSig = sig;
    draw();
  }
  requestAnimationFrame(frame);
}

