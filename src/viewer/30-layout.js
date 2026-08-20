/* ════════════════════ layout ════════════════════ */
let LAYOUT = { nodes: [], districts: [], servicePlates: [], bbox: null };

function relayout() {
  const vis = visibleSet();
  // Keyed by the district id the payload publishes, and carrying its service
  // and layer rather than re-splitting the id: a service id may contain the
  // separator, so parsing the key back apart would be a silent bug.
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

  // How a district packs its own members. The district GRID itself — service
  // down, layer across — is not an option: those axes are the information
  // design, and rearranging them would be a different diagram rather than a
  // different look. What a reader gains from here is aspect: a wide district
  // reads along the layer axis, a tall one reads down the service axis.
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
    blocks.forEach((n, i) => {
      n.gx = ox[L] + (i % c) * SPACING;
      n.gy = oy[Sv] + Math.floor(i / c) * SPACING;
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

  // `ids` is what tells an overlay or a packet whether a node is on the map at
  // all: a node selected from the panel may have been filtered out since, and
  // its cached faces would still be sitting on it from an earlier layout.
  LAYOUT = {
    nodes: vis, districts, servicePlates, bbox: null,
    ids: new Set(vis.map(n => n.id)),
    steps: isFlowView(S.view) ? pathSteps() : new Map(),
    edges: visibleEdges(vis),
  };
  reproject();
  buildPackets();
  staticDirty = true;
}

/**
 * Everything that depends on the camera angle and nothing that depends on the
 * layout. Rotating re-runs this; it does not repack districts or move a single
 * block. Hit testing needs no counterpart because it inverse-transforms to
 * world space and ray-casts these same polygons.
 */
function reproject() {
  const vis = LAYOUT.nodes;

  // Depth sort generalizes: order by projected ground depth, ties broken by
  // projected x. At 45° both reduce to the gx+gy / gx ordering they replace.
  vis.sort((a, b) =>
    depthOf(a.gx, a.gy) - depthOf(b.gx, b.gy) ||
    screenXOf(a.gx, a.gy) - screenXOf(b.gx, b.gy));

  // A face is drawn when it turns toward the camera, decided by the sign of its
  // projected area rather than by which quadrant the yaw is in. The quadrant
  // test only ever worked for a four-sided footprint aligned to the axes; this
  // one is total, so an eight-sided or stepped block is not a special case.
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

      // Sides first, then the cap: within one prism that is already
      // back-to-front, and the prisms themselves are listed bottom-up.
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        const quad = [P(ax, ay, z1), P(bx, by, z1), P(bx, by, z0), P(ax, ay, z0)];
        if (!facesCamera(quad)) continue;
        // Two shades so adjacent walls read apart, keyed to which way the wall
        // runs rather than to a fixed left/right that a rotation invalidates.
        faces.push({ pts: quad, shade: Math.abs(bx - ax) > Math.abs(by - ay) ? -0.42 : -0.22 });
      }
      faces.push({ pts: ring.map(([x, y]) => P(x, y, z1)), shade: 0, cap: true });
    }

    n.faces = faces;
    n.top = P(gx + 0.5, gy + 0.5, h);
  }

  // Accumulated, not spread. `Math.min(...pts)` passes one argument per point —
  // eight per node — and blows the argument limit into a RangeError somewhere
  // around 8k nodes, which is a crash on exactly the repos worth drawing.
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
  // Plates are part of the picture, so they are part of what the camera frames.
  // Without them a row whose plate reaches past its tallest block gets cropped,
  // and so does the tab hanging off that plate's corner.
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

