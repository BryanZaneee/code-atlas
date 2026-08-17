/* ════════════════════ camera ════════════════════ */
/**
 * `pad` leaves room for what the bounding box does not contain: the plate tabs
 * lean outside their own plate, and a cropped label is worse than a smaller map.
 */
function fitBox(b, pad = 0.94, reserveLeft = 0) {
  if (!b) return;
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const w = Math.max(1, W - reserveLeft);
  S.zoom = clamp(Math.min(w / bw, H / bh) * pad, 0.12, 3);
  S.panX = reserveLeft + w / 2 - ((b.x0 + b.x1) / 2) * S.zoom;
  S.panY = H / 2 - ((b.y0 + b.y1) / 2) * S.zoom;
}

/**
 * A service tab hangs off the left of its plate in SCREEN space, so no amount
 * of world-space bounding box accounts for it — at a low zoom the same label is
 * many more world units wide. The frame reserves the measured width instead,
 * which is why the longest service name is not the one that gets cropped.
 */
function fitView() {
  octx.font = `600 11px ${FONT}`;
  let reserve = 0;
  for (const p of LAYOUT.plates) reserve = Math.max(reserve, octx.measureText(p.label).width);
  fitBox(LAYOUT.bbox, 0.94, reserve ? reserve + 24 : 0);
}
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

