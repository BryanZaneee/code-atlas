/* ════════════════════ hit testing ════════════════════ */
function inPoly(px, py, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function pickPacket(sx, sy) {
  let best = null, bd = 11;
  for (const p of livePackets) {
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function pickNode(sx, sy) {
  const w = toWorld({ x: sx, y: sy });
  for (let i = LAYOUT.nodes.length - 1; i >= 0; i--) {
    const n = LAYOUT.nodes[i];
    if (dimOf(n)) continue;
    // The same polygons the renderer drew; if these diverge the map becomes a lie you can click on.
    for (const f of n.faces) if (inPoly(w.x, w.y, f.pts)) return n;
  }
  return null;
}


/** The district under the cursor, by the same quad `drawStatic` fills; blocks are not consulted, since alt-drag has nothing to disambiguate against. */
function pickDistrict(sx, sy) {
  const w = toWorld({ x: sx, y: sy });
  for (const d of LAYOUT.districts) {
    const quad = [project(d.x0, d.y0, 0), project(d.x1, d.y0, 0), project(d.x1, d.y1, 0), project(d.x0, d.y1, 0)];
    if (inPoly(w.x, w.y, quad)) return d;
  }
  return null;
}
