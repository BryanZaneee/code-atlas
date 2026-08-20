/* ════════════════════ render ════════════════════ */
const cv = $("#cv"), ctx = cv.getContext("2d");
const off = document.createElement("canvas"), octx = off.getContext("2d");
let staticDirty = true, W = 0, H = 0, DPR = 1;

/**
 * The static layer — plates, districts, ambient edges, blocks, labels — is
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
// Slack for labels and plate tabs, which are drawn in SCREEN px and therefore
// cover more world px the further out you are: a fixed world-space pad crops
// exactly the long service tab at exactly the zoom you first see it at.
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
  // Selection and hover are deliberately NOT here. They used to be, which made
  // clicking a block re-rasterise the entire city and made a hover state
  // unaffordable at any frame rate. They are drawn in the live pass instead.
  return [
    S.view, S.query, S.focusDistrict, S.yaw, S.colorMode, S.isolate,
    S.shape, S.packing, S.density, S.ground, LAYOUT.nodes.length,
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
  // Already ordered back-to-front by reproject(), and already filtered to the
  // faces that turn toward the camera — so this draws whatever the shape is
  // without knowing which shape it is.
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

/**
 * The projected corner of a plate that `better` prefers.
 *
 * Which corner is nearest, or leftmost, depends on the camera angle, so a tab
 * cannot be pinned to a fixed one. Picking it per plate is what keeps the
 * labels outside the blocks through a full rotation.
 */
function cornerOf(p, better) {
  let best = null;
  for (const [gx, gy] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
    const q = project(gx, gy, 0);
    if (!best || better(q, best)) best = q;
  }
  return best;
}

/**
 * A label on a leader line back to the corner it names.
 *
 * Anchoring beats floating: an unanchored district title drifts into the blocks
 * as soon as the layout changes, which it does on every filter and every toggle.
 */
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

/**
 * The ground plane, in world space and under everything.
 *
 * It does three jobs: it stops the blocks reading as floating, it gives the
 * only depth cue a flat-shaded axonometric view has, and it gives the eye a
 * fixed reference during a pan. Stepped by the layout's own grid unit, so the
 * lines run through the block origins instead of near them.
 */
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
  // Faint on purpose: the grid is the ground, and it must never compete with
  // the blocks standing on it. The order that has to hold, lightest first, is
  // grid << plate < block fill < block stroke — on the old cream ground .22
  // read as texture, on white it read as a second set of edges.
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

  // Fade to the ground colour toward the edges, so the grid never competes with
  // the city and never announces where the layout happens to stop.
  const c = project((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const r = Math.max(ext.w, ext.h) / 2;
  const fade = x.createRadialGradient(c.x, c.y, r * 0.25, c.x, c.y, r);
  fade.addColorStop(0, alpha(BG, 0));
  fade.addColorStop(1, alpha(BG, 1));
  x.fillStyle = fade;
  x.fillRect(ext.x0, ext.y0, ext.w, ext.h);
  x.restore();
}

/** World extent to cache: the blocks, the plates under them, and slack for text. */
function cacheExtent() {
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
  drawGrid(octx, ext, px);

  // service plates, then district plates
  for (const p of LAYOUT.servicePlates) {
    quad(octx, [project(p.x0, p.y0, 0), project(p.x1, p.y0, 0), project(p.x1, p.y1, 0), project(p.x0, p.y1, 0)],
      alpha(THEME.plate, .075), alpha(THEME.plate, .16), px(1));
    // Anchored to the plate's leftmost corner and leaning further left, so the
    // service name leaves the blocks alone. The old caption sat on the far
    // corner, which at this camera angle is behind them.
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
    // On the NEAREST corner, and below it: everything the district contains is
    // drawn behind that corner, so a tab there cannot be overdrawn.
    if (zf > 0.3) {
      octx.save();
      octx.fillStyle = alpha(INK, dim ? .28 : .55);
      octx.font = `${px(clamp(9 * zf, 7, 12))}px ${FONT}`;
      octx.textAlign = "left";
      tab(octx, cornerOf(d, (a, b) => a.y > b.y), px(6), px(14), `${d.code} · ${d.label.toLowerCase()}`, px);
      octx.restore();
    }
  }

  // Ambient edges sit on the ground, under the blocks. Bucketed by style so the
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

  // blocks, painter's order
  const edgeStroke = px(1);
  for (const n of LAYOUT.nodes) {
    octx.globalAlpha = dimOf(n) ? 0.16 : 1;
    drawBlock(octx, n, same, edgeStroke);
  }
  octx.globalAlpha = 1;

  // Labels in a second pass, nearest first, so a foreground block never paints
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

/**
 * How sure the tool is that a hop happens, in line weight and dash.
 *
 * derive.mjs grades every hop of a derived path `wired` (a mount registration
 * the scan actually read), `imported` (a real import edge runs the same way) or
 * `inferred` (a gap — nothing in the graph justifies it). All three used to
 * draw identically while the flow blurb promised dotted for the gaps, so a
 * guess read exactly like a proof. That is the one thing the honesty contract
 * forbids.
 *
 * Weight and dash carry it, never colour: colour is already spoken for by the
 * step's kind (request vs response vs io), and the palette lives in the payload
 * theme, not here. Certainty is a second channel over the top of it — thick and
 * solid for proven, hairline and dotted for admitted guesswork — so the two
 * readings survive together.
 *
 * Opacity only trims, and is deliberately the weakest of the three. A step that
 * is not the current one already draws at 0.16, and much below that it stops
 * being drawn at all against a dark ground. An invisible hop reads as a path
 * that does not have that hop — which makes the map look SURER than it is, the
 * honesty contract failing backwards. A guess has to stay legible enough to be
 * doubted.
 *
 * A curated flow step has no certainty and is returned its table style
 * untouched.
 */
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

/**
 * Convex hull of a point set, monotone chain.
 *
 * A block in axonometric projection silhouettes to a hexagon whose vertices are
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

/**
 * The block's ground footprint — the widest prism in the shape, at z=0, which
 * is what the eye reads as the thing standing on the plate.
 */
function footprintOf(n) {
  const shape = SHAPES[S.shape] ?? SHAPES.block;
  const widest = shape.prisms.reduce((a, b) => (b.pts.length >= a.pts.length && b.z0 <= a.z0 ? b : a));
  return widest.pts.map(([dx, dy]) => project(n.gx + dx, n.gy + dy, 0));
}

/**
 * The outline of whatever was actually drawn. Taken from the face list rather
 * than from a rectangle assumed around the node, so the selection ring cannot drift
 * away from the shape under it.
 */
function silhouetteOf(n) {
  return hullOf(footprintOf(n).concat(n.faces.flatMap((f) => f.pts)));
}

/**
 * The flow trace, as a veil over the cached city rather than a second raster.
 *
 * The dim tiers live in the static layer, so easing them there would
 * re-rasterise the whole map every frame. Veiling the viewport and redrawing
 * what should stay bright costs one fillRect and a handful of blocks, and the
 * ease comes free — which matters, because the transition is what tells you the
 * map changed rather than reloaded.
 *
 * Not everything dims equally. The grid comes back at full strength so the
 * frame survives; off-path blocks drop to the veil; off-path labels and codes
 * are simply not redrawn, because dimmed text is unreadable rather than quiet.
 */
let veil = 0;

function drawTrace() {
  if (veil < 0.02) return;
  ctx.save();
  ctx.globalAlpha = veil;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // The grid, redrawn in world space through the live transform — the same
  // function the raster uses, so the two can never disagree.
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
  drawTrace();
  // Before the overlay, after the city: a finding veils the map, and the
  // selection ring has to stay legible on top of the veil.
  drawFindings();
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

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Eased, not cut: the transition is what says the map changed rather than
  // reloaded. Nothing else in the frame depends on it, so it never invalidates.
  // Nothing to veil when the map holds only the flow already.
  const target = isFlowView(S.view) && LAYOUT.steps.size && !S.isolate ? 0.82 : 0;
  veil += (target - veil) * Math.min(1, dt * 7);
  easeFindings(dt);
  if (S.running || S.stepBudget > 0) advance(dt);
  draw();
  requestAnimationFrame(frame);
}

