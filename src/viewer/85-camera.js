/* ════════════════════ camera ════════════════════ */
function fitBox(b, pad = 0.94) {
  if (!b) return;
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  S.zoom = clamp(Math.min(W / bw, H / bh) * pad, 0.12, 3);
  S.panX = W / 2 - ((b.x0 + b.x1) / 2) * S.zoom;
  S.panY = H / 2 - ((b.y0 + b.y1) / 2) * S.zoom;
}
function fitView() { fitBox(LAYOUT.bbox); }
function focusOn(d) {
  // Accumulated rather than spread, for the same reason the bounding box is:
  // a district with thousands of members would otherwise blow the argument
  // limit on the way to framing itself.
  if (!d.members.length) return;
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const n of d.members) {
    for (const face of [n.faceTop, n.faceLeft]) {
      for (const p of face) {
        if (p.x < b.x0) b.x0 = p.x;
        if (p.x > b.x1) b.x1 = p.x;
        if (p.y < b.y0) b.y0 = p.y;
        if (p.y > b.y1) b.y1 = p.y;
      }
    }
  }
  if (!Number.isFinite(b.x0)) return;
  fitBox(b, 0.62);
}

