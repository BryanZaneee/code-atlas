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
      label: layerById.get(L)?.label ?? L });
  }

  // service plates wrap all of a row's districts
  const plates = services.map(Sv => {
    const ds = districts.filter(d => d.service === Sv);
    if (!ds.length) return null;
    return {
      service: Sv, label: svcById.get(Sv)?.label ?? Sv,
      x0: Math.min(...ds.map(d => d.x0)) - 0.9, y0: Math.min(...ds.map(d => d.y0)) - 0.9,
      x1: Math.max(...ds.map(d => d.x1)) + 0.9, y1: Math.max(...ds.map(d => d.y1)) + 0.9,
    };
  }).filter(Boolean);

  // depth sort is exact: footprints are integer and never straddle
  vis.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy) || a.gx - b.gx);

  // world-space face polygons, camera independent -> computed once per layout
  for (const n of vis) {
    const { gx, gy, h } = n;
    const P = (a, b, c) => project(a, b, c);
    n.faceTop   = [P(gx, gy, h), P(gx + 1, gy, h), P(gx + 1, gy + 1, h), P(gx, gy + 1, h)];
    n.faceRight = [P(gx + 1, gy, h), P(gx + 1, gy + 1, h), P(gx + 1, gy + 1, 0), P(gx + 1, gy, 0)];
    n.faceLeft  = [P(gx, gy + 1, h), P(gx + 1, gy + 1, h), P(gx + 1, gy + 1, 0), P(gx, gy + 1, 0)];
    n.top = P(gx + 0.5, gy + 0.5, h);
  }

  let bbox = null;
  if (vis.length) {
    const pts = vis.flatMap(n => [...n.faceTop, ...n.faceLeft]);
    bbox = {
      x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)),
      y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)),
    };
  }
  LAYOUT = { nodes: vis, districts, plates, bbox, edges: visibleEdges(vis) };
  buildPackets();
  staticDirty = true;
}

