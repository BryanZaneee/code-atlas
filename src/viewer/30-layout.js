/* ═══ layout ═══ */
let LAYOUT = { nodes: [], districts: [], servicePlates: [], bbox: null };
let layoutEpoch = 0;
const districtOffset = (id) => S.districtOffsets.get(id) ?? { dx: 0, dy: 0 };
const nodeOffset = (id) => S.nodeOffsets.get(id) ?? { dx: 0, dy: 0 };

/* ── compaction (U1) + composition (U2) ───────────────────────────────────
   A district sizes itself from its own block count (never from the fattest
   district in its column), districts shelf-pack into their service band with a
   skyline, the band wraps at a width chosen to keep the plan square, and each
   district is nudged by a hash of its own id — same id, same nudge, forever. */
const pseudoIds = new Set();
function megablock(p) {
  const loc = p.blocks.reduce((a, n) => a + (n.loc || 0), 0);
  const id = `district:${p.id}`;
  const n = {
    id, name: (p.key.split("/").pop() || p.key), dir: p.key, service: p.service,
    layer: p.blocks[0]?.layer, kind: "district", lang: "-", loc,
    exports: p.blocks.reduce((a, x) => a + (x.exports || 0), 0),
    inDeg: 0, outDeg: 0, externals: [], coverage: null, collapsed: true,
    members: p.blocks.map((b) => b.id), _dk: p.id,
    note: `${p.blocks.length} files collapsed into one megablock. Height is the district's total lines. Double-click to expand.`,
  };
  byId.set(id, n);
  pseudoIds.add(id);
  return n;
}
function districtCols(count, PACK) {
  return Math.min(count, Math.max(1, Math.round(Math.sqrt(count) * PACK) || 1));
}
/* Two barycentre sweeps: files that import each other end up adjacent.
   Alphabetical stays the tiebreak, so the result is deterministic. */
function barycentre(plots) {
  for (const p of plots.values()) {
    if (p.blocks.length < 3) continue;
    const med = new Map();
    for (const n of p.blocks) {
      const xs = [];
      for (const e of edgesFrom.get(n.id) ?? []) { const o = byId.get(e.to); if (o?.gx !== undefined) xs.push(o.gx); }
      for (const e of edgesTo.get(n.id) ?? []) { const o = byId.get(e.from); if (o?.gx !== undefined) xs.push(o.gx); }
      if (!xs.length) { med.set(n.id, n.gx ?? 0); continue; }
      xs.sort((a, b) => a - b);
      med.set(n.id, xs[Math.floor(xs.length / 2)]);
    }
    p.blocks.sort((a, b) => (med.get(a.id) - med.get(b.id)) || a.name.localeCompare(b.name));
  }
}
function packBand(ds, T) {
  const width = Math.max(T, ...ds.map((p) => p.w + 1), 1);
  const heights = new Array(width).fill(0);
  for (const p of ds) {
    const w = p.w + 1, hh = p.h + 1;
    let bestX = 0, bestY = Infinity;
    for (let x = 0; x + w <= width; x++) {
      let y = 0;
      for (let k = x; k < x + w; k++) y = Math.max(y, heights[k]);
      if (y < bestY - 1e-6) { bestY = y; bestX = x; }
    }
    p.px = bestX; p.py = bestY;
    for (let k = bestX; k < bestX + w; k++) heights[k] = bestY + hh;
  }
  return Math.max(0, ...heights);
}
const rectsOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function jitterBand(ds) {
  const rects = ds.map((p) => ({ x0: p.px, y0: p.py, x1: p.px + p.w + 1, y1: p.py + p.h + 1 }));
  ds.forEach((p, i) => {
    const h = fnv(p.id);
    const tries = [[h % 3 === 0 ? 1 : 0, (h >> 5) % 2], [h % 2, 0], [0, 0]];
    for (const [jx, jy] of tries) {
      if (!jx && !jy) return;
      const r = { x0: p.px + jx, y0: p.py + jy, x1: p.px + p.w + 1 + jx, y1: p.py + p.h + 1 + jy };
      if (rects.every((o, k) => k === i || !rectsOverlap(r, o))) { p.px += jx; p.py += jy; rects[i] = r; return; }
    }
  });
}
/* The plate hugs the district: a full-row block plus the partial tail is an
   L, never more than six vertices, so it always reads as a footprint. */
function districtPoly(ox, oy, c, count) {
  const full = Math.floor(count / c), rem = count - full * c;
  const X = (n) => ox + (n - 1) * SPACING + 1.45;
  const Y = (n) => oy + (n - 1) * SPACING + 1.45;
  const x0 = ox - 0.45, y0 = oy - 0.45;
  if (!full) return [[x0, y0], [X(rem), y0], [X(rem), Y(1)], [x0, Y(1)]];
  if (!rem) return [[x0, y0], [X(c), y0], [X(c), Y(full)], [x0, Y(full)]];
  return [[x0, y0], [X(c), y0], [X(c), Y(full)], [X(rem), Y(full)], [X(rem), Y(full + 1)], [x0, Y(full + 1)]];
}
function relayout() {
  setDensity(S.density);
  for (const id of pseudoIds) byId.delete(id);
  pseudoIds.clear();
  const vis0 = visibleSet();
  const plots = new Map();
  for (const n of vis0) {
    const key = groupKeyOf(n);
    const k = districtId(n.service, key);
    n._dk = k;
    if (!plots.has(k)) plots.set(k, { id: k, service: n.service, key, blocks: [] });
    plots.get(k).blocks.push(n);
  }
  for (const p of plots.values()) {
    p.blocks.sort((x, y) => x.name.localeCompare(y.name));
    if (S.collapsed.has(p.id) && p.blocks.length > 1) { p.members = p.blocks; p.blocks = [megablock(p)]; }
  }
  const vis = [...plots.values()].flatMap((p) => p.blocks);

  const svcOrder = ATLAS.services.slice().sort((a, b) => a.order - b.order).map(s => s.id);
  const services = svcOrder.filter(s => vis.some(n => n.service === s));
  const PACK = { grid: 1, wide: 1.6, tall: 0.62 }[S.packing] ?? 1;

  const list = [...plots.values()];
  for (const p of list) {
    p.c = districtCols(p.blocks.length, PACK);
    p.w = p.c;
    p.h = Math.ceil(p.blocks.length / p.c);
  }
  const area = list.reduce((a, p) => a + (p.w + 1) * (p.h + 1), 0);
  const widest = Math.max(1, ...list.map((p) => p.w + 1));
  const bandRows = S.bands === "auto" ? 0 : clamp(parseInt(S.bands, 10) || 1, 1, ASPECT.maxBands);
  const shapeBias = S.packing === "wide" ? ASPECT.target : S.packing === "tall" ? 1 / ASPECT.target : 1;
  let T = Math.max(widest, Math.round(Math.sqrt(area) * shapeBias));
  if (bandRows) {
    const longest = Math.max(...services.map((sv) => list.filter((p) => p.service === sv).reduce((a, p) => a + p.w + 1, 0)));
    T = Math.max(widest, Math.ceil(longest / bandRows));
  }

  const byService = new Map();
  for (const p of list) {
    if (!byService.has(p.service)) byService.set(p.service, []);
    byService.get(p.service).push(p);
  }
  const svcY = new Map(), svcZ = new Map();
  let cursor = 0;
  services.forEach((sv, i) => {
    const ds = (byService.get(sv) ?? []).sort((a, b) => keyCompare(a.key, b.key));
    const bandH = packBand(ds, T);
    jitterBand(ds);
    const realH = Math.max(bandH, ...ds.map((p) => p.py + p.h + 1));
    svcY.set(sv, cursor);
    svcZ.set(sv, S.plinths ? i * PLINTH_STEP : 0);
    cursor += realH * SPACING + GUT_SVC;
  });

  const districts = [];
  const place = () => {
    districts.length = 0;
    for (const p of list) {
      const off = districtOffset(p.id);
      const ox = (p.px + off.dx) * SPACING;
      const oy = svcY.get(p.service) + (p.py + off.dy) * SPACING;
      const pz = svcZ.get(p.service) ?? 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      p.blocks.forEach((n, i) => {
        const no = nodeOffset(n.id);
        n.gx = ox + ((i % p.c) + no.dx) * SPACING;
        n.gy = oy + (Math.floor(i / p.c) + no.dy) * SPACING;
        n.pz = pz;
        n.h = heightOf(n);
        x0 = Math.min(x0, n.gx); y0 = Math.min(y0, n.gy);
        x1 = Math.max(x1, n.gx); y1 = Math.max(y1, n.gy);
      });
      districts.push({ id: p.id, key: p.key, service: p.service, blocks: p.blocks, pz,
        x0: x0 - 0.45, y0: y0 - 0.45, x1: x1 + 1.45, y1: y1 + 1.45,
        poly: districtPoly(ox, oy, p.c, p.blocks.length),
        collapsed: S.collapsed.has(p.id),
        layer0: p.blocks[0]?.layer,
        label: labelForKey(p.key) });
    }
  };
  place();
  barycentre(plots); place();
  barycentre(plots); place();

  const plateSrc = new Map();
  for (const d of districts) {
    if (!plateSrc.has(d.service)) plateSrc.set(d.service, []);
    plateSrc.get(d.service).push(d);
  }
  const servicePlates = services.map(Sv => {
    const ds = plateSrc.get(Sv);
    if (!ds?.length) return null;
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const d of ds) {
      if (d.x0 < b.x0) b.x0 = d.x0;
      if (d.y0 < b.y0) b.y0 = d.y0;
      if (d.x1 > b.x1) b.x1 = d.x1;
      if (d.y1 > b.y1) b.y1 = d.y1;
    }
    return { service: Sv, label: svcById.get(Sv)?.label ?? Sv, pz: svcZ.get(Sv) ?? 0,
      x0: b.x0 - 0.9, y0: b.y0 - 0.9, x1: b.x1 + 0.9, y1: b.y1 + 0.9 };
  }).filter(Boolean);

  const occupied = new Set();
  for (const n of vis) occupied.add(`${Math.round(n.gx / SPACING)},${Math.round(n.gy / SPACING)}`);

  LAYOUT = { nodes: vis, districts, servicePlates, bbox: null, occupied,
    ids: new Set(vis.map(n => n.id)),
    steps: playsFlow(S.view) ? pathSteps() : new Map(),
    edges: visibleEdges(vis) };
  reproject();
  buildPackets();
  staticDirty = true;
}

function reproject() {
  const vis = LAYOUT.nodes;
  vis.sort((a, b) => depthOf(a.gx, a.gy) - depthOf(b.gx, b.gy) || screenXOf(a.gx, a.gy) - screenXOf(b.gx, b.gy));
  const facesCamera = (poly) => {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
    return a < 0;
  };
  for (const n of vis) {
    const shape = shapeFor(n);
    const { gx, gy } = n;
    const h = n.h * shape.hs;
    const base = n.pz ?? 0;
    const side = footScale(n);
    const P = project;
    const faces = [];
    for (const prism of shape.prisms) {
      const z0 = base + h * prism.z0, z1 = base + h * prism.z1;
      const ring = prism.pts.map(([dx, dy]) => [gx + 0.5 + (dx - 0.5) * side, gy + 0.5 + (dy - 0.5) * side]);
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        const quad = [P(ax, ay, z1), P(bx, by, z1), P(bx, by, z0), P(ax, ay, z0)];
        if (!facesCamera(quad)) continue;
        faces.push({ pts: quad, shade: Math.abs(bx - ax) > Math.abs(by - ay) ? -0.42 : -0.22 });
      }
      faces.push({ pts: ring.map(([x, y]) => P(x, y, z1)), shade: 0, cap: true });
    }
    n.faces = faces;
    n.top = P(gx + 0.5, gy + 0.5, base + h);
    n.bandCount = S.facade && n.kind !== "endpoint" ? Math.min(10, Math.floor((n.loc ?? 0) / 50)) : 0;
    n.marks = {
      hatch: n.coverage === "none",
      notch: (n.kind === "file" || n.kind === "district") && !n.inDeg && !n.outDeg,
      spire: ENDPOINT_OWNERS.has(n.id),
    };
  }
  let bbox = null;
  if (vis.length) bbox = bboxOf(vis);
  if (bbox) for (const p of LAYOUT.servicePlates) {
    for (const [gx, gy] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
      const q = project(gx, gy, p.pz ?? 0);
      if (q.x < bbox.x0) bbox.x0 = q.x;
      if (q.x > bbox.x1) bbox.x1 = q.x;
      if (q.y < bbox.y0) bbox.y0 = q.y;
      if (q.y > bbox.y1) bbox.y1 = q.y;
    }
  }
  LAYOUT.bbox = bbox;
  staticDirty = true;
}

function districtRectAt(d, off) {
  const cur = districtOffset(d.id);
  const sx = (off.dx - cur.dx) * SPACING, sy = (off.dy - cur.dy) * SPACING;
  return { x0: d.x0 + sx, y0: d.y0 + sy, x1: d.x1 + sx, y1: d.y1 + sy };
}
function districtWouldOverlap(id, off) {
  const me = LAYOUT.districts.find((x) => x.id === id);
  if (!me) return false;
  const r = districtRectAt(me, off);
  return LAYOUT.districts.some((o) => o.id !== id && r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1);
}
function moveDistrict(id, cells) {
  const cur = districtOffset(id);
  const next = { dx: cur.dx + cells.dx, dy: cur.dy + cells.dy };
  if (next.dx === cur.dx && next.dy === cur.dy) return true;
  if (districtWouldOverlap(id, next)) return false;
  if (next.dx === 0 && next.dy === 0) S.districtOffsets.delete(id);
  else S.districtOffsets.set(id, next);
  layoutEpoch++;
  relayout();
  return true;
}
function nodeWouldOverlap(id, cells) {
  const n = byId.get(id);
  if (!n) return true;
  const tx = n.gx + cells.dx * SPACING, ty = n.gy + cells.dy * SPACING;
  const d = LAYOUT.districts.find((x) => x.id === n._dk);
  /* A block outside its district would make the district label a lie. Refuse. */
  if (d && (tx < d.x0 - 0.1 || tx + 1 > d.x1 + 0.1 || ty < d.y0 - 0.1 || ty + 1 > d.y1 + 0.1)) return true;
  return LAYOUT.nodes.some((o) => o.id !== id && Math.abs(o.gx - tx) < SPACING * 0.55 && Math.abs(o.gy - ty) < SPACING * 0.55);
}
function moveNode(id, cells) {
  if (!cells.dx && !cells.dy) return true;
  if (nodeWouldOverlap(id, cells)) return false;
  const cur = nodeOffset(id);
  const next = { dx: cur.dx + cells.dx, dy: cur.dy + cells.dy };
  if (!next.dx && !next.dy) S.nodeOffsets.delete(id);
  else S.nodeOffsets.set(id, next);
  layoutEpoch++;
  relayout();
  return true;
}
function resetOffsets() {
  if (!S.districtOffsets.size && !S.nodeOffsets.size && !S.collapsed.size) return false;
  S.districtOffsets.clear();
  S.nodeOffsets.clear();
  S.collapsed.clear();
  layoutEpoch++;
  relayout();
  return true;
}
function toggleCollapse(id) {
  if (S.collapsed.has(id)) S.collapsed.delete(id);
  else S.collapsed.add(id);
  S.selected = null; S.pinnedPacket = null;
  layoutEpoch++;
  relayout();
  renderList(); renderInspect();
}
