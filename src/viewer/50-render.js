/* ════════════════════ render ════════════════════ */
const cv = $("#cv"), ctx = cv.getContext("2d");
const off = document.createElement("canvas"), octx = off.getContext("2d");
let staticDirty = true, W = 0, H = 0, DPR = 1;

/**
 * The static layer — plates, districts, ambient edges, buildings, labels — is
 * cached in WORLD space, not screen space.
 *
 * Screen-space caching was worth nothing: panning changes the screen position
 * of every pixel, so the cache was invalidated on every drag frame and the
 * whole city was redrawn at 60 Hz. In world space a pan is a different blit
 * offset and costs one drawImage.
 *
 * Zoom still changes the rasterisation, so the cache is rendered at a quantized
 * scale — a mip level — and re-rendered only when the zoom crosses a bucket.
 * Between buckets the blit scales the bitmap, at most ~13% off true size.
 */
const CACHE = { key: "", scale: 0, x0: 0, y0: 0, w: 1, h: 1 };
const MAX_CACHE_SIDE = 8192;   // hard limit on the backing store, per side
const CACHE_PAD = 220;         // world px of slack for labels and plate captions

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
  // Selection and hover are deliberately NOT here. They used to be, which made
  // clicking a block re-rasterise the entire city and made a hover state
  // unaffordable at any frame rate. They are drawn in the live pass instead.
  return [
    S.view, S.query, S.focusDistrict, S.yaw, S.colorMode, LAYOUT.nodes.length,
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

function dimOf(n) {
  if (S.query) {
    const q = S.query.toLowerCase();
    if (!n.id.toLowerCase().includes(q) && !(n.name ?? "").toLowerCase().includes(q)) return true;
  }
  if (S.focusDistrict && `${n.service}|${n.layer}` !== S.focusDistrict) return true;
  return false;
}

/** World extent to cache: the buildings, the plates under them, and slack for text. */
function cacheExtent() {
  const b = LAYOUT.bbox ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  let x0 = b.x0, y0 = b.y0, x1 = b.x1, y1 = b.y1;
  for (const p of LAYOUT.plates) {
    for (const [gx, gy] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
      const q = project(gx, gy, 0);
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
  }
  return { x0: x0 - CACHE_PAD, y0: y0 - CACHE_PAD, w: x1 - x0 + CACHE_PAD * 2, h: y1 - y0 + CACHE_PAD * 2 };
}

function drawStatic() {
  const ext = cacheExtent();
  // Fit the backing store to the budget rather than the wish: a very large repo
  // at a very high zoom would otherwise ask for a canvas no browser will give.
  const wanted = mipScale(S.zoom);
  const scale = Math.min(wanted, MAX_CACHE_SIDE / (Math.max(ext.w, ext.h) * DPR));

  CACHE.key = cacheKey();
  CACHE.scale = wanted;
  CACHE.x0 = ext.x0; CACHE.y0 = ext.y0; CACHE.w = ext.w; CACHE.h = ext.h;

  off.width = Math.max(1, Math.round(ext.w * scale * DPR));
  off.height = Math.max(1, Math.round(ext.h * scale * DPR));
  // Draw in world coordinates from here on; the transform does the mapping.
  const m = scale * DPR;
  octx.setTransform(m, 0, 0, m, -ext.x0 * m, -ext.y0 * m);

  // Screen-space sizes have to be divided back out, since the transform scales
  // strokes and glyphs along with geometry.
  const px = (v) => v / scale;
  const zf = scale;                      // the zoom this raster is drawn for

  octx.fillStyle = BG;
  octx.fillRect(ext.x0, ext.y0, ext.w, ext.h);

  // service plates, then district plates
  for (const p of LAYOUT.plates) {
    quad(octx, [project(p.x0, p.y0, 0), project(p.x1, p.y0, 0), project(p.x1, p.y1, 0), project(p.x0, p.y1, 0)],
      alpha(THEME.plate, .075), alpha(THEME.plate, .16), px(1));
    const s = project(p.x0, p.y0, 0);
    octx.save();
    octx.fillStyle = alpha(INK, .62);
    octx.font = `600 ${px(clamp(11 * zf, 8, 15))}px ${FONT}`;
    octx.textAlign = "left";
    octx.fillText(p.label, s.x + px(8 * zf), s.y - px(5 * zf));
    octx.restore();
  }
  for (const d of LAYOUT.districts) {
    const dim = S.focusDistrict && S.focusDistrict !== d.id;
    quad(octx, [project(d.x0, d.y0, 0), project(d.x1, d.y0, 0), project(d.x1, d.y1, 0), project(d.x0, d.y1, 0)],
      alpha(THEME.plate, dim ? .05 : .13), alpha(THEME.plate, .2), px(1));
    if (zf > 0.4) {
      const s = project(d.x0, d.y1, 0);
      octx.save();
      octx.fillStyle = alpha(INK, dim ? .28 : .55);
      octx.font = `${px(clamp(9 * zf, 7, 12))}px ${FONT}`;
      octx.textAlign = "left";
      octx.fillText(d.label.toLowerCase(), s.x + px(5 * zf), s.y + px(11 * zf));
      octx.restore();
    }
  }

  // Ambient edges sit on the ground, under the boxes. Bucketed by style so the
  // stroke state is set once per bucket instead of once per edge — with a
  // save()/restore() pair each, that was the single hottest loop here.
  if (!isFlowView(S.view)) {
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

  // boxes, painter's order
  const edgeStroke = px(1);
  for (const n of LAYOUT.nodes) {
    const base = colorOf(n);
    octx.globalAlpha = dimOf(n) ? 0.16 : 1;
    quad(octx, n.faceLeft,  shade(base, -0.42), alpha(THEME.edge, .28), edgeStroke);
    quad(octx, n.faceRight, shade(base, -0.22), alpha(THEME.edge, .28), edgeStroke);
    quad(octx, n.faceTop,   base, alpha(THEME.edge, .38), edgeStroke);
  }
  octx.globalAlpha = 1;

  // Labels in a second pass, nearest first, so a foreground box never paints
  // over a label and colliding labels drop out instead of turning to mush.
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

  // The selected node no longer gets a special case here: its label is part of
  // the live overlay, so it survives labels being off and zoomed past.
  for (let i = LAYOUT.nodes.length - 1; showLabels && i >= 0; i--) {
    const n = LAYOUT.nodes[i];
    if (dimOf(n)) continue;
    const w = widthOf(n.name);
    const box = { x: n.top.x - w / 2, y: n.top.y - px(5) - px(size), w, h: px(size + 3) };
    if (hits(box)) continue;
    taken.push(box);
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

function drawDiamond(x, p, r, fill) {
  x.beginPath();
  x.moveTo(p.x, p.y - r); x.lineTo(p.x + r, p.y); x.lineTo(p.x, p.y + r); x.lineTo(p.x - r, p.y);
  x.closePath(); x.fillStyle = fill; x.fill();
}

/**
 * Convex hull of a point set, monotone chain.
 *
 * A box in axonometric projection silhouettes to a hexagon whose vertices are
 * six of its eight projected corners. There is a closed form, but it has to
 * case on which quadrant the camera is in; a hull is total at every yaw for the
 * same dozen lines. It runs for the one or two nodes an overlay touches, never
 * per node per frame.
 */
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

/** The four ground corners the layout already knows — the block's footprint. */
function footprintOf(n) {
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) => project(n.gx + dx, n.gy + dy, 0));
}

function silhouetteOf(n) {
  return hullOf(footprintOf(n).concat([[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) => project(n.gx + dx, n.gy + dy, n.h))));
}

/**
 * Selection, hover and flow membership, drawn AFTER the city is blitted.
 *
 * Two reasons it lives here and not in the static layer. It is state, and state
 * changes on every interaction — baking it into the world cache meant one click
 * re-rasterised everything. And an overlay is allowed to ignore the painter's
 * algorithm: a silhouette chewed up by the block in front of it is
 * depth-realistic and illegible, and legibility wins here and only here.
 *
 * Selection gets the full silhouette AND a footprint ring on the ground,
 * because the top face is barely a third of a tall block's area and much less
 * of a short one's. The ring is what makes a one-storey block as legible as a
 * tower. Hover gets a lighter silhouette and no ring, so the two never read the
 * same.
 */
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

    // The name on a chip rather than a haloed string: at this size the halo is
    // what the static layer uses to survive a busy background, and the overlay
    // has one solid colour available that nothing else on the map uses.
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

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const o = toScreen({ x: CACHE.x0, y: CACHE.y0 });
  ctx.drawImage(off, 0, 0, off.width, off.height, o.x, o.y, CACHE.w * S.zoom, CACHE.h * S.zoom);
  drawOverlay();
  livePackets = [];

  // flow arcs above the city so packets are never occluded
  for (const r of runners) {
    r.steps.forEach((s, i) => {
      const cur = i === r.i;
      drawArc(ctx, s.arc, EDGE_STYLE[s.kind] ?? EDGE_STYLE.request, cur ? 0.85 : 0.16);
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

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.running || S.stepBudget > 0) advance(dt);
  draw();
  requestAnimationFrame(frame);
}

