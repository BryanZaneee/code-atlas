/* ════════════════════ camera ════════════════════ */
function fitBox(b, pad = 0.94) {
  if (!b) return;
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  S.zoom = clamp(Math.min(W / bw, H / bh) * pad, 0.12, 3);
  S.panX = W / 2 - ((b.x0 + b.x1) / 2) * S.zoom;
  S.panY = H / 2 - ((b.y0 + b.y1) / 2) * S.zoom;
  staticDirty = true;
}
function fitView() { fitBox(LAYOUT.bbox); }
function focusOn(d) {
  const pts = d.members.flatMap(n => [...n.faceTop, ...n.faceLeft]);
  if (!pts.length) return;
  fitBox({
    x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)),
    y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)),
  }, 0.62);
}

