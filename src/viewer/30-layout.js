/* ════════════════════ layout ════════════════════ */
let LAYOUT = { nodes: [], districts: [], servicePlates: [], bbox: null };
// Bumped on every committed drag: the raster cache key cannot otherwise see a district that moved without changing size.
let layoutEpoch = 0;

/** How far a reader has pulled a district, in cells. Absent means unmoved. */
const districtOffset = (id) => S.districtOffsets.get(id) ?? { dx: 0, dy: 0 };

function relayout() {
  setDensity(S.density);
  const vis = visibleSet();
  // Carries service and layer rather than re-splitting the id: a service id may contain the separator.
  const plots = new Map();
  for (const n of vis) {
    const k = districtId(n.service, n.layer);
    if (!plots.has(k)) plots.set(k, { service: n.service, layer: n.layer, blocks: [] });
    plots.get(k).blocks.push(n);
  }
  for (const p of plots.values()) p.blocks.sort((x, y) => x.name.localeCompare(y.name));

  const layers = [...new Set(vis.map(n => n.layer))].sort((a, b) => (layerById.get(a)?.rank ?? 99) - (layerById.get(b)?.rank ?? 99));
  const svcOrder = ATLAS.services.slice().sort((a, b) => a.order - b.order).map(s => s.id);
  const services = svcOrder.filter(s => vis.some(n => n.service === s));

  // Packing sets a district's aspect only; the service-down/layer-across grid is the information design and is not an option.
  const PACK = { grid: 1, wide: 1.9, tall: 0.5 }[S.packing] ?? 1;
  const cols = (n) => Math.max(1, Math.round(Math.sqrt(n) * PACK) || 1);
  const rowsOf = (n) => Math.ceil(n / cols(n));

  const layerW = {}, svcH = {};
  for (const L of layers) layerW[L] = Math.max(1, ...services.map(Sv => { const p = plots.get(districtId(Sv, L)); return p ? cols(p.blocks.length) : 0; }));
  for (const Sv of services) svcH[Sv] = Math.max(1, ...layers.map(L => { const p = plots.get(districtId(Sv, L)); return p ? rowsOf(p.blocks.length) : 0; }));

  const ox = {}, oy = {};
  let x = 0; for (const L of layers) { ox[L] = x; x += layerW[L] * SPACING + GUT_LAYER; }
  let y = 0; for (const Sv of services) { oy[Sv] = y; y += svcH[Sv] * SPACING + GUT_SVC; }

  const districts = [];
  for (const [k, plot] of plots) {
    const { service: Sv, layer: L, blocks } = plot;
    if (!(L in ox) || !(Sv in oy)) continue;
    const c = cols(blocks.length);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const off = districtOffset(k);
    blocks.forEach((n, i) => {
      n.gx = ox[L] + (i % c) * SPACING + off.dx * SPACING;
      n.gy = oy[Sv] + Math.floor(i / c) * SPACING + off.dy * SPACING;
      n.h = heightOf(n);
      x0 = Math.min(x0, n.gx); y0 = Math.min(y0, n.gy);
      x1 = Math.max(x1, n.gx); y1 = Math.max(y1, n.gy);
    });
    districts.push({ id:k, service:Sv, layer:L, blocks,
      x0:x0 - 0.45, y0:y0 - 0.45, x1:x1 + 1.45, y1:y1 + 1.45,
      code: codeByDistrict.get(k) ?? "",
      label: layerById.get(L)?.label ?? L });
  }

  // service plates wrap all of a row's districts
  const byService = new Map();
  for (const d of districts) {
    if (!byService.has(d.service)) byService.set(d.service, []);
    byService.get(d.service).push(d);
  }
  const servicePlates = services.map(Sv => {
    const ds = byService.get(Sv);
    if (!ds?.length) return null;
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const d of ds) {
      if (d.x0 < b.x0) b.x0 = d.x0;
      if (d.y0 < b.y0) b.y0 = d.y0;
      if (d.x1 > b.x1) b.x1 = d.x1;
      if (d.y1 > b.y1) b.y1 = d.y1;
    }
    return {
      service: Sv, label: svcById.get(Sv)?.label ?? Sv,
      x0: b.x0 - 0.9, y0: b.y0 - 0.9, x1: b.x1 + 0.9, y1: b.y1 + 0.9,
    };
  }).filter(Boolean);

  // `ids` is how an overlay or packet tells a node is still on the map; stale cached faces outlive a filter change.
  LAYOUT = {
    nodes: vis, districts, servicePlates, bbox: null,
    ids: new Set(vis.map(n => n.id)),
    steps: playsFlow(S.view) ? pathSteps() : new Map(),
    edges: visibleEdges(vis),
  };
  reproject();
  buildPackets();
  staticDirty = true;
}

/** Camera-angle work only: rotating re-runs this and repacks nothing. Hit testing ray-casts these same polygons. */
function reproject() {
  const vis = LAYOUT.nodes;

  // Depth sort by projected ground depth, ties broken by projected x, so it holds at any yaw.
  vis.sort((a, b) =>
    depthOf(a.gx, a.gy) - depthOf(b.gx, b.gy) ||
    screenXOf(a.gx, a.gy) - screenXOf(b.gx, b.gy));

  // Facing is the sign of the projected area, not a yaw quadrant test, so eight-sided and stepped blocks are not special cases.
  const facesCamera = (poly) => {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
    }
    return a < 0;
  };

  const shape = SHAPES[S.shape] ?? SHAPES.block;

  for (const n of vis) {
    const { gx, gy } = n;
    const h = n.h * shape.hs;
    const P = project;
    const faces = [];

    for (const prism of shape.prisms) {
      const z0 = h * prism.z0, z1 = h * prism.z1;
      const ring = prism.pts.map(([dx, dy]) => [gx + dx, gy + dy]);

      // Sides then cap is already back-to-front within a prism, and prisms are listed bottom-up.
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        const quad = [P(ax, ay, z1), P(bx, by, z1), P(bx, by, z0), P(ax, ay, z0)];
        if (!facesCamera(quad)) continue;
        // Shade keys off which way the wall runs, not a fixed left/right that rotating would invalidate.
        faces.push({ pts: quad, shade: Math.abs(bx - ax) > Math.abs(by - ay) ? -0.42 : -0.22 });
      }
      faces.push({ pts: ring.map(([x, y]) => P(x, y, z1)), shade: 0, cap: true });
    }

    n.faces = faces;
    n.top = P(gx + 0.5, gy + 0.5, h);
  }

  // Accumulated, not spread: `Math.min(...pts)` hits the argument limit and throws RangeError around 8k nodes.
  let bbox = null;
  if (vis.length) {
    bbox = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const n of vis) {
      for (const face of n.faces) {
        for (const p of face.pts) {
          if (p.x < bbox.x0) bbox.x0 = p.x;
          if (p.x > bbox.x1) bbox.x1 = p.x;
          if (p.y < bbox.y0) bbox.y0 = p.y;
          if (p.y > bbox.y1) bbox.y1 = p.y;
        }
      }
    }
  }
  // Plates extend the bbox, or a row whose plate reaches past its tallest block gets cropped.
  if (bbox) {
    for (const p of LAYOUT.servicePlates) {
      for (const [gx, gy] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
        const q = project(gx, gy, 0);
        if (q.x < bbox.x0) bbox.x0 = q.x;
        if (q.x > bbox.x1) bbox.x1 = q.x;
        if (q.y < bbox.y0) bbox.y0 = q.y;
        if (q.y > bbox.y1) bbox.y1 = q.y;
      }
    }
  }
  LAYOUT.bbox = bbox;
  staticDirty = true;
}


/** The rect a district would occupy at `off`; `d`'s rect already carries its current offset, so this is a delta. */
function districtRectAt(d, off) {
  const cur = districtOffset(d.id);
  const sx = (off.dx - cur.dx) * SPACING, sy = (off.dy - cur.dy) * SPACING;
  return { x0: d.x0 + sx, y0: d.y0 + sy, x1: d.x1 + sx, y1: d.y1 + sy };
}

/** Districts may be rearranged, never stacked: two on the same cells put two blocks on one lattice point and the depth sort has no answer. */
function districtWouldOverlap(id, off) {
  const me = LAYOUT.districts.find((x) => x.id === id);
  if (!me) return false;
  const r = districtRectAt(me, off);
  return LAYOUT.districts.some((o) => o.id !== id && r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1);
}

/** Commit a drag, or return false and move nothing if the drop overlaps. Relayout rebuilds packets, whose arcs are frozen at build time. */
function moveDistrict(id, cells) {
  const cur = districtOffset(id);
  const next = { dx: cur.dx + cells.dx, dy: cur.dy + cells.dy };
  // A drag that ended where it started is a wobbly click; bumping the epoch would re-raster the city for the same picture.
  if (next.dx === cur.dx && next.dy === cur.dy) return true;
  if (districtWouldOverlap(id, next)) return false;
  if (next.dx === 0 && next.dy === 0) S.districtOffsets.delete(id);
  else S.districtOffsets.set(id, next);
  layoutEpoch++;
  relayout();
  return true;
}

/** Back to the computed layout. Nothing to redraw if nothing had been moved. */
function resetDistrictOffsets() {
  if (!S.districtOffsets.size) return false;
  S.districtOffsets.clear();
  layoutEpoch++;
  relayout();
  return true;
}
