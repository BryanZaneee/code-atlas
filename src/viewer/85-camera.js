/* ════════════════════ camera ════════════════════ */
/** `pad` leaves room for what the bbox does not contain, such as plate tabs leaning outside their own plate. */
function fitBox(b, pad = 0.94, reserveLeft = 0) {
  if (!b) return;
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const w = Math.max(1, W - reserveLeft);
  S.zoom = clamp(Math.min(w / bw, H / bh) * pad, 0.12, 3);
  S.panX = reserveLeft + w / 2 - ((b.x0 + b.x1) / 2) * S.zoom;
  S.panY = H / 2 - ((b.y0 + b.y1) / 2) * S.zoom;
}

/** Service tabs hang off the plate in screen space, which no world-space bbox can cover, so the measured label width is reserved instead. */
function fitView() {
  octx.font = `600 11px ${FONT}`;
  let reserve = 0;
  for (const p of LAYOUT.servicePlates) reserve = Math.max(reserve, octx.measureText(p.label).width);
  fitBox(LAYOUT.bbox, 0.94, reserve ? reserve + 24 : 0);
}
function focusOn(d) {
  // Accumulated, not spread: a district with thousands of members would blow the argument limit on the way to framing itself.
  if (!d.blocks.length) return;
  const b = bboxOf(d.blocks);
  if (!Number.isFinite(b.x0)) return;
  fitBox(b, 0.62);
}

