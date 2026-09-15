/* ═══ camera ═══ */
function fitBox(b, pad = 0.94, reserveLeft = 0, immediate = false) {
  if (!b) return;
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const w = Math.max(1, W - reserveLeft);
  const zoom = clamp(Math.min(w / bw, H / bh) * pad, 0.12, 3);
  const panX = reserveLeft + w / 2 - ((b.x0 + b.x1) / 2) * zoom;
  const panY = H / 2 - ((b.y0 + b.y1) / 2) * zoom;
  if (immediate) { camTween = null; S.zoom = zoom; S.panX = panX; S.panY = panY; }
  else tweenCamera(zoom, panX, panY);
}
function fitView(immediate = false) {
  octx.font = `600 11px ${FONT}`;
  let reserve = 0;
  for (const p of LAYOUT.servicePlates) reserve = Math.max(reserve, octx.measureText(p.label).width);
  fitBox(LAYOUT.bbox, 0.94, reserve ? reserve + 24 : 0, immediate);
}
function focusOn(d) {
  if (!d.blocks.length) return;
  const b = bboxOf(d.blocks);
  if (!Number.isFinite(b.x0)) return;
  fitBox(b, 0.62);
}
