/* ════════════════════ helpers ════════════════════ */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => n.toLocaleString("en-US");

// One district id format, built in one place: payload, layout and S.focusDistrict all key off this.
const districtId = (service, layer) => `${service}/${layer}`;

/** A theme colour at an alpha; Canvas has no colour-mix, and a token per opacity is how palettes get hardcoded. */
function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function shade(hex, amt) {         // amt<0 darken toward black
  const n = parseInt(hex.slice(1), 16);
  const f = 1 + amt;
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}
/** Yaw-parameterized axonometric basis, rotated away from 45° (not from zero) so the default angle is bit-identical, and squashed by K after rotation to hold the 2:1 pitch. */
let A = { x: HW, y: HW * K };
let B = { x: -HW, y: HW * K };

function setYaw(yaw) {
  S.yaw = yaw;
  const d = yaw - YAW0;
  const cd = Math.cos(d), sd = Math.sin(d);
  A = { x: HW * (cd - sd), y: HW * (cd + sd) * K };
  B = { x: -HW * (cd + sd), y: HW * (cd - sd) * K };
}

const project = (gx, gy, h) => ({ x: gx * A.x + gy * B.x, y: gx * A.y + gy * B.y - h });

/** `project` inverted on the ground plane; height has no inverse, so the caller must have decided the point is on the floor. */
function unproject(x, y) {
  const det = A.x * B.y - B.x * A.y;
  return { gx: (x * B.y - y * B.x) / det, gy: (y * A.x - x * A.y) / det };
}

/** Painter's-algorithm key: screen depth of a cell's origin, since every 1x1 footprint shares the same corner offset. */
const depthOf = (gx, gy) => gx * A.y + gy * B.y;
const screenXOf = (gx, gy) => gx * A.x + gy * B.x;
const toScreen = (w) => ({ x: w.x * S.zoom + S.panX, y: w.y * S.zoom + S.panY });
const toWorld = (s) => ({ x: (s.x - S.panX) / S.zoom, y: (s.y - S.panY) / S.zoom });

/** Height normalizes to the repo's own p95, not an absolute scale, so big files stay comparable instead of saturating. */
const LOC_P95 = (() => {
  const locs = ATLAS.nodes.filter(n => n.kind === "file" && n.loc > 0).map(n => n.loc).sort((a, b) => a - b);
  if (!locs.length) return 1;
  return Math.max(1, locs[Math.min(locs.length - 1, Math.floor(locs.length * 0.95))]);
})();
const LOG_P95 = Math.log1p(LOC_P95);

function heightOf(n) {
  if (n.kind === "datastore") return 84;
  if (n.kind === "endpoint") return 22;
  // Past p95 keeps growing but is capped, so one generated 100k-line file cannot flatten the map.
  return 8 + Math.min(130 * Math.log1p(n.loc) / LOG_P95, 260);
}
/** Identity writes to fill only; state (selection, flow, coverage tint) writes to stroke/ring/glow, so `mono` cannot switch state off. */
function colorOf(n) {
  if (viewKind(S.view) === "tests" && n.coverage) {
    const tint = COVER_TINT[n.coverage];
    if (tint) return tint;
  }
  if (S.colorMode === "mono") return THEME.face;
  return layerById.get(n.layer)?.color ?? THEME.layerFallback;
}

/** World bbox over nodes' projected faces. Accumulated, not spread: Math.min(...pts) throws RangeError around 8k nodes. */
function bboxOf(nodes) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const n of nodes) {
    for (const face of n.faces ?? []) {
      for (const p of face.pts) {
        if (p.x < b.x0) b.x0 = p.x;
        if (p.x > b.x1) b.x1 = p.x;
        if (p.y < b.y0) b.y0 = p.y;
        if (p.y > b.y1) b.y1 = p.y;
      }
    }
  }
  return b;
}
