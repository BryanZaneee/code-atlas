/* ═══ render ═══ */
// Bound at load, not at boot: this script tag sits after the markup, so the
// canvas exists by the time the line runs. The design this came from deferred
// both to its mount hook because a component runtime owned the lifecycle; here
// that only left a window where `resize()` could be called against null.
const cv = $("#cv"), ctx = cv?.getContext("2d");
const off = document.createElement("canvas"), octx = off.getContext("2d");
let staticDirty = true, W = 0, H = 0, DPR = 1;
const CACHE = { key: "", scale: 0, x0: 0, y0: 0, w: 1, h: 1 };
const MAX_CACHE_SIDE = 8192;
const MAX_CACHE_PIXELS = ((globalThis.navigator?.deviceMemory ?? 8) >= 8 ? 32 : 8) * 1e6;
const CACHE_PAD = 220;
const mipScale = (zoom) => Math.pow(2, Math.round(Math.log2(zoom) * 3) / 3);

function resize() {
  DPR = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = Math.max(1, Math.round(W * DPR));
  cv.height = Math.max(1, Math.round(H * DPR));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
function cacheKey() {
  const o = S.opts;
  return [S.view, S.query, S.focusDistrict, S.yaw, S.colorMode, S.isolate,
    S.shape, S.packing, S.density, S.ground, S.group, LAYOUT.nodes.length, layoutEpoch,
    S.theme, S.bands, S.roads, S.plinths, S.facade, S.material, S.palettePreset, S.colorBy,
    [...S.keyColors].map(([k, v]) => k + v).join("."),
    [...S.nodeColors].map(([k, v]) => k + v).join("."),
    [...S.nodeShapes].map(([k, v]) => k + v).join("."),
    [...S.nodeSizes].map(([k, v]) => k + v).join("."),
    [...S.shapeByDistrict].map(([k, v]) => k + v).join("."),
    o.docs, o.tests, o.contract, o.labels, o.vendor].join("|");
}
function quad(x, pts, fill, stroke, lw) {
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  x.closePath();
  if (fill) { x.fillStyle = fill; x.fill(); }
  if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw; x.stroke(); }
}
const same = (p) => p;
function drawBlock(x, n, map, lw) {
  const base = colorOf(n);
  const glass = S.material === "glass";
  for (const f of n.faces) {
    let fill;
    if (glass) {
      fill = alpha(shade(base, f.shade + (f.cap ? 0.2 : 0.08)), f.cap ? 0.5 : 0.32);
    } else if (THEME.faceGradient && !f.cap && f.pts.length === 4) {
      const ps = f.pts.map(map);
      let y0 = Infinity, y1 = -Infinity;
      for (const p of ps) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      const g = x.createLinearGradient(0, y0, 0, Math.max(y1, y0 + 0.001));
      g.addColorStop(0, shade(base, f.shade + 0.1));
      g.addColorStop(1, shade(base, f.shade - 0.12));
      fill = g;
    } else fill = shade(base, f.shade);
    quad(x, f.pts.map(map), fill,
      glass ? alpha(shade(base, f.cap ? -0.2 : -0.32), f.cap ? .85 : .6) : alpha(THEME.edge, f.cap ? .58 : .45),
      glass ? lw * 1.3 : lw);
  }
  if (glass) drawGlassSheen(x, n, map, lw);
  if (n.bandCount) drawFacadeBands(x, n, map, lw);
  drawCapMarks(x, n, map, lw);
}
/* liquid glass: one soft highlight down the lit face, so translucency still reads as a solid object */
function drawGlassSheen(x, n, map, lw) {
  const lit = n.faces.find((f) => !f.cap && f.pts.length === 4 && f.shade === -0.22);
  if (!lit) return;
  const p = lit.pts.map(map);
  const at = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const g = x.createLinearGradient(p[0].x, p[0].y, p[2].x, p[2].y);
  const [s0, s1, s2] = THEME.sheen;
  g.addColorStop(0, s0);
  g.addColorStop(0.55, s1);
  g.addColorStop(1, s2);
  quad(x, [at(p[0], p[1], 0.08), at(p[0], p[1], 0.46), at(p[3], p[2], 0.46), at(p[3], p[2], 0.08)], g, null, 0);
}
/* One line per ~50 lines of code: height stops being a vibe and becomes countable. */
function drawFacadeBands(x, n, map, lw) {
  x.save();
  x.strokeStyle = alpha(THEME.edge, .12);
  x.lineWidth = lw;
  x.beginPath();
  for (const f of n.faces) {
    if (f.cap || f.pts.length !== 4) continue;
    const a0 = map(f.pts[0]), b0 = map(f.pts[1]), b1 = map(f.pts[2]), a1 = map(f.pts[3]);
    for (let i = 1; i <= n.bandCount; i++) {
      const t = i / (n.bandCount + 1);
      x.moveTo(a0.x + (a1.x - a0.x) * t, a0.y + (a1.y - a0.y) * t);
      x.lineTo(b0.x + (b1.x - b0.x) * t, b0.y + (b1.y - b0.y) * t);
    }
  }
  x.stroke();
  x.restore();
}
/* State on the roof, stroke only — hatch: untested · notch: orphan · spire: owns an endpoint. */
function drawCapMarks(x, n, map, lw) {
  const m = n.marks;
  if (!m || (!m.hatch && !m.notch && !m.spire)) return;
  const cap = n.faces.find((f) => f.cap && f.pts.length >= 3);
  if (!cap) return;
  const pts = cap.pts.map(map);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cx = 0, cy = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    cx += p.x / pts.length; cy += p.y / pts.length;
  }
  x.save();
  x.lineWidth = lw;
  if (m.hatch) {
    x.save();
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.closePath();
    x.clip();
    x.strokeStyle = alpha(THEME.edge, .42);
    const span = maxX - minX;
    const step = Math.max(lw * 3, (maxY - minY) / 3.4);
    x.beginPath();
    for (let yy = minY - span; yy < maxY + span; yy += step) { x.moveTo(minX, yy); x.lineTo(maxX, yy + span * 0.5); }
    x.stroke();
    x.restore();
  }
  if (m.notch) {
    const a = pts[0], b = pts[1], d = pts[pts.length - 1];
    x.strokeStyle = alpha(THEME.edge, .7);
    x.beginPath();
    x.moveTo(a.x + (b.x - a.x) * 0.36, a.y + (b.y - a.y) * 0.36);
    x.lineTo(a.x + (d.x - a.x) * 0.36, a.y + (d.y - a.y) * 0.36);
    x.stroke();
  }
  if (m.spire) {
    x.strokeStyle = alpha(THEME.edge, .8);
    x.beginPath();
    x.moveTo(cx, cy);
    x.lineTo(cx, cy - lw * 15);
    x.stroke();
    x.beginPath();
    x.arc(cx, cy - lw * 15, lw * 1.6, 0, 7);
    x.fillStyle = alpha(THEME.edge, .8);
    x.fill();
  }
  x.restore();
}
function dimOf(n) {
  if (S.query) {
    const q = S.query.toLowerCase();
    if (!n.id.toLowerCase().includes(q) && !(n.name ?? "").toLowerCase().includes(q)) return true;
  }
  if (S.focusDistrict && n._dk !== S.focusDistrict) return true;
  return false;
}
function cornerOf(p, better, z = 0) {
  let best = null;
  for (const [gx, gy] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
    const q = project(gx, gy, z);
    if (!best || better(q, best)) best = q;
  }
  return best;
}
/* Gutters become streets: negative space that reads as authorship, not as failure to fill. */
function drawStreets(x, px) {
  if (!LAYOUT.occupied?.size) return;
  const cols = new Set(), rows = new Set();
  let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (const k of LAYOUT.occupied) {
    const i = k.indexOf(",");
    const a = +k.slice(0, i), b = +k.slice(i + 1);
    cols.add(a); rows.add(b);
    c0 = Math.min(c0, a); c1 = Math.max(c1, a);
    r0 = Math.min(r0, b); r1 = Math.max(r1, b);
  }
  const y0 = (r0 - 1) * SPACING, y1 = (r1 + 2) * SPACING;
  const x0 = (c0 - 1) * SPACING, x1 = (c1 + 2) * SPACING;
  const seg = (ax, ay, bx, by) => { const a = project(ax, ay, 0), b = project(bx, by, 0); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); };
  x.save();
  x.lineWidth = px(1);
  for (const [w, a] of [[0.13, .10], [-0.13, .06]]) {
    x.strokeStyle = alpha(THEME.plate, a);
    x.beginPath();
    for (let c = c0 - 1; c <= c1 + 1; c++) {
      if (cols.has(c) || (!cols.has(c - 1) && !cols.has(c + 1))) continue;
      seg(c * SPACING + 0.5 + w, y0, c * SPACING + 0.5 + w, y1);
    }
    for (let r = r0 - 1; r <= r1 + 1; r++) {
      if (rows.has(r) || (!rows.has(r - 1) && !rows.has(r + 1))) continue;
      seg(x0, r * SPACING + 0.5 + w, x1, r * SPACING + 0.5 + w);
    }
    x.stroke();
  }
  x.restore();
}
/* District names painted into the plate, iso-skewed — the single largest "this is a map" upgrade. */
/* District names on a short leader line from the near corner — crisp and screen-aligned, never skewed. */
function districtLabel(x, d, text, px, zf) {
  x.save();
  x.font = `${px(clamp(9.5 * zf, 8, 12))}px ${FONT}`;
  x.textAlign = "left";
  tab(x, cornerOf(d, (a, b) => a.y > b.y, d.pz ?? 0), px(7), px(15), text, px);
  x.restore();
}
function tab(x, at, dx, dy, text, px) {
  x.save();
  x.globalAlpha = 0.55;
  x.strokeStyle = x.fillStyle;
  x.lineWidth = px(1);
  x.beginPath(); x.moveTo(at.x, at.y); x.lineTo(at.x + dx, at.y + dy); x.stroke();
  x.restore();
  x.fillText(text, at.x + dx + (dx < 0 ? -px(3) : px(3)), at.y + dy + (dy > 0 ? px(3) : 0));
}
/** A little signpost naming a service: pole up from the plate corner, pennant with the name. */
function flag(x, at, text, px, zf) {
  const fs = px(clamp(10.5 * zf, 8, 14));
  x.save();
  x.font = `600 ${fs}px ${FONT}`;
  const tw = x.measureText(text).width;
  const w = tw + px(12);
  const fh = fs + px(8);
  const poleH = px(40);
  x.strokeStyle = alpha(INK, .6);
  x.lineWidth = px(1.4);
  x.beginPath(); x.moveTo(at.x, at.y); x.lineTo(at.x, at.y - poleH); x.stroke();
  x.fillStyle = alpha(INK, .92);
  x.beginPath();
  x.moveTo(at.x, at.y - poleH);
  x.lineTo(at.x + w, at.y - poleH);
  x.lineTo(at.x + w + px(8), at.y - poleH + fh / 2);
  x.lineTo(at.x + w, at.y - poleH + fh);
  x.lineTo(at.x, at.y - poleH + fh);
  x.closePath();
  x.fill();
  x.fillStyle = BG;
  x.textAlign = "left";
  x.fillText(text, at.x + px(6), at.y - poleH + fh - px(5.5));
  x.restore();
}
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
  x0 = Math.round((x0 - pad) / SPACING) * SPACING;
  y0 = Math.round((y0 - pad) / SPACING) * SPACING;
  x1 = Math.round((x1 + pad) / SPACING) * SPACING;
  y1 = Math.round((y1 + pad) / SPACING) * SPACING;
  x.save();
  x.strokeStyle = alpha(THEME.plate, THEME.gridAlpha ?? .11);
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
  const c = project((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const r = Math.max(ext.w, ext.h) / 2;
  const fade = x.createRadialGradient(c.x, c.y, r * 0.25, c.x, c.y, r);
  fade.addColorStop(0, alpha(BG, 0));
  fade.addColorStop(1, alpha(BG, 1));
  x.fillStyle = fade;
  x.fillRect(ext.x0, ext.y0, ext.w, ext.h);
  x.restore();
}
/* ── roads (U3): route on the lattice, one turn, prefer street corridors ── */
function routeCost(p, q) {
  const steps = Math.max(1, Math.round(Math.hypot(q.x - p.x, q.y - p.y) / (SPACING * 0.5)));
  let cost = steps * 0.02;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round((p.x + (q.x - p.x) * t) / SPACING);
    const cy = Math.round((p.y + (q.y - p.y) * t) / SPACING);
    if (LAYOUT.occupied.has(`${cx},${cy}`)) cost += 1;
  }
  return cost;
}
function elbowFor(a, b) {
  const c1 = { x: b.x, y: a.y }, c2 = { x: a.x, y: b.y };
  return routeCost(a, c1) + routeCost(c1, b) <= routeCost(a, c2) + routeCost(c2, b) ? c1 : c2;
}
function strokeRoute(x, a, b, e, za, zb) {
  const pa = project(a.x, a.y, za), pb = project(b.x, b.y, zb), pe = project(e.x, e.y, (za + zb) / 2);
  const trim = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    const r = Math.min(d * 0.45, 0.3 * SPACING * HW * 0.7);
    return { x: from.x + (dx / d) * r, y: from.y + (dy / d) * r };
  };
  const p1 = trim(pe, pa), p2 = trim(pe, pb);
  x.moveTo(pa.x, pa.y);
  x.lineTo(p1.x, p1.y);
  x.quadraticCurveTo(pe.x, pe.y, p2.x, p2.y);
  x.lineTo(pb.x, pb.y);
}
function drawRoads(x, px, zf) {
  const boost = viewKind(S.view) === "dataflow" ? 3 : 1;
  const buckets = new Map();
  const corridors = new Map();
  for (const e of LAYOUT.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a?.top || !b?.top) continue;
    const faded = dimOf(a) && dimOf(b);
    const key = `${e.kind}|${faded}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { st: EDGE_STYLE[e.kind] ?? EDGE_STYLE.import, faded, runs: [] }));
    const pa = { x: a.gx + 0.5, y: a.gy + 0.5 }, pb = { x: b.gx + 0.5, y: b.gy + 0.5 };
    if (!S.roads) { bucket.runs.push({ a: pa, b: pb, e: null, za: a.pz ?? 0, zb: b.pz ?? 0 }); continue; }
    const el0 = elbowFor(pa, pb);
    const ck = `${Math.round(el0.x / SPACING)},${Math.round(el0.y / SPACING)}`;
    const idx = corridors.get(ck) ?? 0;
    corridors.set(ck, idx + 1);
    const fan = Math.min(idx, 4) * 0.06 * SPACING;   /* bundle, capped at five */
    bucket.runs.push({ a: pa, b: pb, e: { x: el0.x + fan, y: el0.y + fan }, za: a.pz ?? 0, zb: b.pz ?? 0, over: idx > 4 });
  }
  for (const { st, faded, runs } of buckets.values()) {
    x.save();
    x.globalAlpha = Math.min(0.9, st.a * boost * (S.roads ? 1.7 : 1)) * (faded ? 0.25 : 1);
    x.strokeStyle = st.c;
    x.lineWidth = px(st.w * (boost > 1 ? 1.3 : 1));
    x.lineJoin = "round";
    if (st.dash) x.setLineDash(st.dash.map((v) => px(v * zf)));
    x.beginPath();
    for (const r of runs) {
      if (r.e) strokeRoute(x, r.a, r.b, r.e, r.za, r.zb);
      else {
        const p0 = project(r.a.x, r.a.y, r.za), p1 = project(r.b.x, r.b.y, r.zb);
        x.moveTo(p0.x, p0.y); x.lineTo(p1.x, p1.y);
      }
    }
    x.stroke();
    x.restore();
  }
}
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
/** Size the offscreen cache and aim it at the map. `wanted` is the scale the zoom asks for; `bySide` and `byArea` are the two ceilings that keep a large repo from asking for a raster the browser will refuse, so the scale actually used is the smallest of the three. */
function sizeCache() {
  const ext = cacheExtent();
  const wanted = mipScale(S.zoom);
  const bySide = MAX_CACHE_SIDE / (Math.max(ext.w, ext.h) * DPR);
  const byArea = Math.sqrt(MAX_CACHE_PIXELS / Math.max(1, ext.w * ext.h * DPR * DPR));
  const scale = Math.min(wanted, bySide, byArea);
  CACHE.key = cacheKey();
  CACHE.scale = wanted;
  CACHE.x0 = ext.x0; CACHE.y0 = ext.y0; CACHE.w = ext.w; CACHE.h = ext.h;
  off.width = Math.max(1, Math.round(ext.w * scale * DPR));
  off.height = Math.max(1, Math.round(ext.h * scale * DPR));
  const m = scale * DPR;
  octx.setTransform(m, 0, 0, m, -ext.x0 * m, -ext.y0 * m);
  return { ext, scale };
}

function drawStatic() {
  const { ext, scale } = sizeCache();
  const px = (v) => v / scale;
  const zf = scale;
  octx.fillStyle = BG;
  octx.fillRect(ext.x0, ext.y0, ext.w, ext.h);
  drawGrid(octx, ext, px);
  drawStreets(octx, px);
  for (const p of LAYOUT.servicePlates) {
    const z = p.pz ?? 0;
    if (z) {
      /* plinth skirt: separation by elevation instead of by gap */
      quad(octx, [project(p.x0, p.y1, z), project(p.x1, p.y1, z), project(p.x1, p.y1, 0), project(p.x0, p.y1, 0)],
        alpha(THEME.plate, .16), alpha(THEME.plate, .22), px(1));
      quad(octx, [project(p.x1, p.y0, z), project(p.x1, p.y1, z), project(p.x1, p.y1, 0), project(p.x1, p.y0, 0)],
        alpha(THEME.plate, .1), alpha(THEME.plate, .2), px(1));
    }
    quad(octx, [project(p.x0, p.y0, z), project(p.x1, p.y0, z), project(p.x1, p.y1, z), project(p.x0, p.y1, z)],
      alpha(THEME.plate, .075), alpha(THEME.plate, .16), px(1));
    flag(octx, cornerOf(p, (a, b) => a.x < b.x, z), p.label, px, zf);
  }
  for (const d of LAYOUT.districts) {
    const dim = S.focusDistrict && S.focusDistrict !== d.id;
    quad(octx, d.poly.map(([gx, gy]) => project(gx, gy, d.pz ?? 0)),
      alpha(THEME.plate, dim ? .05 : .13), alpha(THEME.plate, d.collapsed ? .34 : .2), px(d.collapsed ? 1.6 : 1));
    if (zf > 0.3) {
      octx.save();
      octx.fillStyle = alpha(INK, dim ? .3 : .62);
      districtLabel(octx, d, d.label.toLowerCase(), px, zf);
      octx.restore();
    }
  }
  if (!playsFlow(S.view)) drawRoads(octx, px, zf);
  if (THEME.blockShadow) {
    octx.save();
    for (const n of LAYOUT.nodes) {
      if (dimOf(n)) continue;
      const fp = footprintOf(n).map((p) => ({ x: p.x + 3 + n.h * 0.03, y: p.y + 4 + n.h * 0.04 }));
      quad(octx, fp, THEME.shadow, null, 0);
    }
    octx.restore();
  }
  const edgeStroke = px(1);
  for (const n of LAYOUT.nodes) {
    octx.globalAlpha = dimOf(n) ? 0.16 : 1;
    drawBlock(octx, n, same, edgeStroke);
  }
  octx.globalAlpha = 1;
  const showLabels = S.opts.labels && zf >= 0.55;
  const size = clamp(10 * zf, 8, 13);
  const taken = [];
  const hits = (r) => taken.some(t => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
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
function drawArc(x, arc, style, alphaV) {
  const a = toScreen(arc.a), b = toScreen(arc.b), c = toScreen({ x: arc.cx, y: arc.cy });
  x.save();
  x.globalAlpha = alphaV;
  x.strokeStyle = style.c;
  x.lineWidth = style.w * clamp(S.zoom, 0.6, 1.6);
  if (style.dash) x.setLineDash(style.dash.map(v => v * S.zoom));
  x.beginPath(); x.moveTo(a.x, a.y); x.quadraticCurveTo(c.x, c.y, b.x, b.y); x.stroke();
  x.restore();
}
const CERTAINTY_STYLE = {
  wired:    { wMul: 1.55, aMul: 1, dash: null },
  imported: { wMul: 1, aMul: 0.94, dash: null },
  inferred: { wMul: 0.7, aMul: 0.86, dash: [2, 5] },
};
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
function drawDragGhost() {
  if (S.dragNode) {
    const n = byId.get(S.dragNode);
    if (!n || !n.faces) return;
    const { dx, dy } = S.dragCells;
    if (!dx && !dy) return;
    const p0 = project(n.gx, n.gy, 0), p1 = project(n.gx + dx * SPACING, n.gy + dy * SPACING, 0);
    const ddx = p1.x - p0.x, ddy = p1.y - p0.y;
    const blocked = nodeWouldOverlap(n.id, S.dragCells);
    const c = blocked ? THEME.findingSeverity.error : THEME.accent;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = alpha(c, .9);
    ctx.fillStyle = alpha(c, blocked ? .12 : .08);
    const pts = footprintOf(n).map((p) => toScreen({ x: p.x + ddx, y: p.y + ddy }));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }
  const d = S.dragDistrict && LAYOUT.districts.find((x) => x.id === S.dragDistrict);
  if (!d) return;
  const { dx, dy } = S.dragCells;
  if (!dx && !dy) return;
  const offc = districtOffset(d.id);
  const next = { dx: offc.dx + dx, dy: offc.dy + dy };
  const r = districtRectAt(d, next);
  const blocked = districtWouldOverlap(d.id, next);
  const c = blocked ? THEME.findingSeverity.error : THEME.accent;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = alpha(c, .9);
  ctx.fillStyle = alpha(c, blocked ? .1 : .07);
  ctx.beginPath();
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([gx, gy]) => toScreen(project(gx, gy, 0)));
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
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
function footprintOf(n) {
  const shape = shapeFor(n);
  const widest = shape.prisms.reduce((a, b) => (b.pts.length >= a.pts.length && b.z0 <= a.z0 ? b : a));
  const side = footScale(n);
  return widest.pts.map(([dx, dy]) => project(n.gx + 0.5 + (dx - 0.5) * side, n.gy + 0.5 + (dy - 0.5) * side, n.pz ?? 0));
}
function silhouetteOf(n) {
  return hullOf(footprintOf(n).concat(n.faces.flatMap((f) => f.pts)));
}

/** Light a block: its footprint washed in, its silhouette outlined. The selection, a finding's evidence and a live response all say the same thing this way, so they say it in one place. */
function highlightBlock(ctx, n, col, { fill = 0.32, lw = 2 } = {}) {
  ctx.globalAlpha = fill;
  quad(ctx, footprintOf(n).map(toScreen), col, null, 0);
  ctx.globalAlpha = 1;
  quad(ctx, silhouetteOf(n).map(toScreen), null, col, lw);
}
let veil = 0, viewFade = 0;
function drawTrace() {
  if (veil < 0.02) return;
  ctx.save();
  ctx.globalAlpha = veil;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
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
function chip(x, at, text, fill, dy = 28) {
  x.font = `600 11px ${FONT}`;
  x.textAlign = "center";
  const w = x.measureText(text).width;
  x.fillStyle = fill;
  x.fillRect(at.x - w / 2 - 5, at.y - dy, w + 10, 15);
  x.fillStyle = BG;
  x.fillText(text, at.x, at.y - dy + 11);
}
function drawOverlay() {
  const pick = (id) => (id && LAYOUT.ids.has(id) ? byId.get(id) : null);
  const sel = pick(S.selected);
  const hov = S.hover === S.selected ? null : pick(S.hover);
  if (S.move) {
    /* arrange mode announces itself: a grab handle at each district's near corner */
    ctx.save();
    ctx.strokeStyle = alpha(THEME.accent, .75);
    ctx.lineWidth = 1.5;
    for (const d of LAYOUT.districts) {
      const c = toScreen(cornerOf(d, (a, b) => a.y > b.y, d.pz ?? 0));
      const s = 7;
      ctx.beginPath();
      ctx.moveTo(c.x - s, c.y); ctx.lineTo(c.x, c.y + s); ctx.lineTo(c.x + s, c.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save();
  if (hov) quad(ctx, silhouetteOf(hov).map(toScreen), null, THEME.accent, 1);
  if (sel) {
    highlightBlock(ctx, sel, THEME.accent, { fill: 0.34 });
    chip(ctx, toScreen(sel.top), sel.name, THEME.accent);
  }
  ctx.restore();
}
let livePackets = [];
/* ── arrival (U5): live-pass only, so the world raster is built exactly once ── */
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
function introKeys() {
  const n = Math.max(1, LAYOUT.nodes.length);
  if (S.introOrder !== "district") return LAYOUT.nodes.map((_, i) => i / n);
  const seen = new Map();
  for (const node of LAYOUT.nodes) if (!seen.has(node._dk)) seen.set(node._dk, seen.size);
  const total = Math.max(1, seen.size);
  return LAYOUT.nodes.map((node) => (seen.get(node._dk) ?? 0) / total);
}
function drawIntro() {
  const T = S.introT;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.setTransform(DPR * S.zoom, 0, 0, DPR * S.zoom, DPR * S.panX, DPR * S.panY);
  const px = (v) => v / S.zoom;
  ctx.globalAlpha = clamp(T / 0.15, 0, 1);
  drawGrid(ctx, cacheExtent(), px);
  drawStreets(ctx, px);
  for (const p of LAYOUT.servicePlates) {
    const z = p.pz ?? 0;
    quad(ctx, [project(p.x0, p.y0, z), project(p.x1, p.y0, z), project(p.x1, p.y1, z), project(p.x0, p.y1, z)],
      alpha(THEME.plate, .075), alpha(THEME.plate, .16), px(1));
  }
  for (const d of LAYOUT.districts) {
    quad(ctx, d.poly.map(([gx, gy]) => project(gx, gy, d.pz ?? 0)), alpha(THEME.plate, .13), alpha(THEME.plate, .2), px(1));
  }
  ctx.restore();
  const keys = introKeys();
  LAYOUT.nodes.forEach((node, i) => {
    const start = 0.1 + keys[i] * 0.55;
    const local = clamp((T - start) / 0.3, 0, 1);
    if (local <= 0) return;
    const lift = (1 - easeOutCubic(local)) * (node.h + 40);
    ctx.globalAlpha = Math.min(1, local * 3);
    drawBlock(ctx, node, (p) => { const s = toScreen(p); return { x: s.x, y: s.y + lift }; }, 1);
  });
  ctx.globalAlpha = 1;
}
function startIntro() {
  S.introT = REDUCED_MOTION || !S.intro ? 1 : 0;
}
function draw() {
  if (S.introT < 1) { drawIntro(); return; }
  if (staticDirty || CACHE.key !== cacheKey() || CACHE.scale !== mipScale(S.zoom)) drawStatic();
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
    livePackets.push({ x: s.x, y: s.y, kind: "edge", data: p.e });
  }
  for (const r of runners) {
    const st = r.steps[r.i];
    if (!st) continue;
    const col = PACKET_COLOR[st.kind] ?? PACKET_COLOR.request;
    for (let i = 0; i < r.trail.length; i++) {
      const tp = toScreen(r.trail[i]);
      ctx.globalAlpha = (i / r.trail.length) * 0.35;
      drawDiamond(ctx, tp, clamp((1.4 + 2.4 * (i / r.trail.length)) * S.zoom, 1, 5), col);
    }
    ctx.globalAlpha = 1;
    const w = bez(st.arc, r.t), s = toScreen(w);
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = THEME.glow ? 16 : 8;
    drawDiamond(ctx, s, clamp(5 * S.zoom, 3.5, 8), col);
    ctx.restore();
    ctx.strokeStyle = alpha(BG, .9); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, clamp(5 * S.zoom, 3.5, 8) + 2, 0, 7); ctx.stroke();
    livePackets.push({ x: s.x, y: s.y, kind: "step", data: st });
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
  for (const p of pulses) {
    const s = toScreen({ x: p.x, y: p.y });
    ctx.save();
    ctx.globalAlpha = (1 - p.t) * 0.5;
    ctx.strokeStyle = p.c;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(s.x, s.y, (5 + 30 * p.t) * clamp(S.zoom, 0.5, 1.5), 0, 7);
    ctx.stroke();
    ctx.restore();
  }
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
  if (viewFade > 0.01) {
    ctx.save();
    ctx.globalAlpha = viewFade * 0.85;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
function frameSig() {
  const r = S.request?.live;
  return `${cacheKey()}|${W}x${H}|${S.zoom}|${S.panX}|${S.panY}|${S.selected}|${S.hover}|${S.finding}|${S.dragDistrict}|${S.dragNode}|${S.dragCells.dx},${S.dragCells.dy}|${veil.toFixed(3)}|${findVeil.toFixed(3)}|${viewFade.toFixed(3)}|${r ? `${r.status},${r.ms}` : ""}`;
}
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let camTween = null;
function tweenCamera(zoom, panX, panY, d = 0.55) {
  if (REDUCED_MOTION || !W) { S.zoom = zoom; S.panX = panX; S.panY = panY; return; }
  camTween = { t: 0, d, z0: S.zoom, x0: S.panX, y0: S.panY, z1: zoom, x1: panX, y1: panY };
}
let last = performance.now();
let lastSig = null;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (camTween) {
    camTween.t += dt / camTween.d;
    const k = easeInOut(Math.min(1, camTween.t));
    S.zoom = camTween.z0 + (camTween.z1 - camTween.z0) * k;
    S.panX = camTween.x0 + (camTween.x1 - camTween.x0) * k;
    S.panY = camTween.y0 + (camTween.y1 - camTween.y0) * k;
    if (camTween.t >= 1) camTween = null;
  }
  if (viewFade > 0) viewFade = Math.max(0, viewFade - dt * 2.8);
  for (const p of pulses) p.t += dt * 1.7;
  pulses = pulses.filter((p) => p.t < 1);
  const target = playsFlow(S.view) && LAYOUT.steps.size && !S.isolate ? 0.82 : 0;
  veil += (target - veil) * Math.min(1, dt * 7);
  easeFindings(dt);
  if (S.introT < 1) {
    S.introT = Math.min(1, S.introT + (dt * 1000) / INTRO.ms);
    draw();
    if (S.introT >= 1) { staticDirty = true; lastSig = null; }
    requestAnimationFrame(frame);
    return;
  }
  const playing = (S.running || S.stepBudget > 0) && (runners.length || ambient.length);
  if (S.running || S.stepBudget > 0) advance(dt);
  const sig = frameSig();
  if (playing || staticDirty || pulses.length || camTween || sig !== lastSig) {
    lastSig = sig;
    draw();
  }
  requestAnimationFrame(frame);
}
