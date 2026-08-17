/* ════════════════════ layout ════════════════════ */
let LAYOUT = { nodes: [], districts: [], plates: [], bbox: null };

function relayout() {
  const vis = visibleSet();
  const plots = new Map();
  for (const n of vis) {
    const k = `${n.service}|${n.layer}`;
    if (!plots.has(k)) plots.set(k, []);
    plots.get(k).push(n);
  }
  for (const a of plots.values()) a.sort((x, y) => x.name.localeCompare(y.name));

  const layers = [...new Set(vis.map(n => n.layer))].sort((a, b) => (layerById.get(a)?.rank ?? 99) - (layerById.get(b)?.rank ?? 99));
  const svcOrder = ATLAS.services.slice().sort((a, b) => a.order - b.order).map(s => s.id);
  const services = svcOrder.filter(s => vis.some(n => n.service === s));

  const cols = (n) => Math.ceil(Math.sqrt(n));
  const rowsOf = (n) => Math.ceil(n / cols(n));

  const layerW = {}, svcH = {};
  for (const L of layers) layerW[L] = Math.max(1, ...services.map(Sv => { const a = plots.get(`${Sv}|${L}`); return a ? cols(a.length) : 0; }));
  for (const Sv of services) svcH[Sv] = Math.max(1, ...layers.map(L => { const a = plots.get(`${Sv}|${L}`); return a ? rowsOf(a.length) : 0; }));

  const ox = {}, oy = {};
  let x = 0; for (const L of layers) { ox[L] = x; x += layerW[L] * SPACING + GUT_LAYER; }
  let y = 0; for (const Sv of services) { oy[Sv] = y; y += svcH[Sv] * SPACING + GUT_SVC; }

  const districts = [];
  for (const [k, arr] of plots) {
    const [Sv, L] = k.split("|");
    if (!(L in ox) || !(Sv in oy)) continue;
    const c = cols(arr.length);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    arr.forEach((n, i) => {
      n.gx = ox[L] + (i % c) * SPACING;
      n.gy = oy[Sv] + Math.floor(i / c) * SPACING;
      n.h = heightOf(n);
      x0 = Math.min(x0, n.gx); y0 = Math.min(y0, n.gy);
      x1 = Math.max(x1, n.gx); y1 = Math.max(y1, n.gy);
    });
    districts.push({ id:k, service:Sv, layer:L, members:arr,
      x0:x0 - 0.45, y0:y0 - 0.45, x1:x1 + 1.45, y1:y1 + 1.45,
      code: codeByGroup.get(`${Sv}/${L}`) ?? "",
      label: layerById.get(L)?.label ?? L });
  }

  // service plates wrap all of a row's districts
  const byService = new Map();
  for (const d of districts) {
    if (!byService.has(d.service)) byService.set(d.service, []);
    byService.get(d.service).push(d);
  }
  const plates = services.map(Sv => {
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
  LAYOUT = { nodes: vis, districts, plates, bbox: null, ids: new Set(vis.map(n => n.id)), edges: visibleEdges(vis) };
  reproject();
  buildPackets();
  staticDirty = true;
}

/**
 * Everything that depends on the camera angle and nothing that depends on the
 * layout. Rotating re-runs this; it does not repack districts or move a single
 * building. Hit testing needs no counterpart because it inverse-transforms to
 * world space and ray-casts these same polygons.
 */
function reproject() {
  const vis = LAYOUT.nodes;

  // Depth sort generalizes: order by projected ground depth, ties broken by
  // projected x. At 45° both reduce to the gx+gy / gx ordering they replace.
  vis.sort((a, b) =>
    depthOf(a.gx, a.gy) - depthOf(b.gx, b.gy) ||
    screenXOf(a.gx, a.gy) - screenXOf(b.gx, b.gy));

  // Which vertical faces we can see depends on which way the camera looks, so
  // the visible plane is chosen per axis instead of assuming one quadrant.
  const fx = A.y > 0 ? 1 : 0;
  const fy = B.y > 0 ? 1 : 0;

  for (const n of vis) {
    const { gx, gy, h } = n;
    const P = project;
    n.faceTop   = [P(gx, gy, h), P(gx + 1, gy, h), P(gx + 1, gy + 1, h), P(gx, gy + 1, h)];
    n.faceRight = [P(gx + fx, gy, h), P(gx + fx, gy + 1, h), P(gx + fx, gy + 1, 0), P(gx + fx, gy, 0)];
    n.faceLeft  = [P(gx, gy + fy, h), P(gx + 1, gy + fy, h), P(gx + 1, gy + fy, 0), P(gx, gy + fy, 0)];
    n.top = P(gx + 0.5, gy + 0.5, h);
  }

  // Accumulated, not spread. `Math.min(...pts)` passes one argument per point —
  // eight per node — and blows the argument limit into a RangeError somewhere
  // around 8k nodes, which is a crash on exactly the repos worth drawing.
  let bbox = null;
  if (vis.length) {
    bbox = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const n of vis) {
      for (const face of [n.faceTop, n.faceLeft, n.faceRight]) {
        for (const p of face) {
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
    for (const p of LAYOUT.plates) {
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

