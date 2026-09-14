/* ════════════════════ helpers ════════════════════ */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => n.toLocaleString("en-US");

// A district is one service crossed with one layer, and this is its id in every
// surface that names one: the payload publishes it, the viewer lays it out by
// it, and `S.focusDistrict` holds it. One format, built in one place, because
// two formats for one identity is two keyspaces that silently miss each other.
const districtId = (service, layer) => `${service}/${layer}`;

/**
 * A theme colour at an alpha. Canvas has no colour-mix, and the alternative is
 * a named token per opacity — thirteen of them, in one palette, which is how
 * the cream palette ended up hardcoded across the renderer in the first place.
 */
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
/**
 * Yaw-parameterized axonometric projection. The layout never moves; only the
 * camera does.
 *
 * The basis is expressed as a rotation AWAY from 45° rather than from zero, so
 * at the default angle the deltas are exactly cos(0)=1 and sin(0)=0 and the
 * projection is bit-identical to the fixed one it replaces. Computing it from
 * cos(yaw)/sin(yaw) directly is algebraically the same and drifts by an ulp,
 * which is enough to move every cached polygon.
 *
 * Rotation happens in unsquashed ground space and is squashed by K afterwards,
 * which is what keeps the 2:1 tile pitch constant at every angle.
 */
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

/**
 * `project` inverted, on the ground plane.
 *
 * The projection is a 2x2 matrix built from the yaw basis, so undoing it is
 * that matrix inverted — no search, no approximation, and correct at every
 * angle for the same reason `project` is. Height has no inverse: a screen point
 * names a ground cell only once you have decided it is on the ground, which is
 * exactly what a drag along the floor has decided.
 */
function unproject(x, y) {
  const det = A.x * B.y - B.x * A.y;
  return { gx: (x * B.y - y * B.x) / det, gy: (y * A.x - x * A.y) / det };
}

/**
 * Painter's-algorithm key: the screen depth of a cell's ground footprint.
 * Every box is the same 1x1 size, so the nearest-corner offset is a constant
 * and drops out of the comparison — leaving the projected origin. At 45° this
 * reduces to gx+gy, the ordering it replaces.
 */
const depthOf = (gx, gy) => gx * A.y + gy * B.y;
const screenXOf = (gx, gy) => gx * A.x + gy * B.x;
const toScreen = (w) => ({ x: w.x * S.zoom + S.panX, y: w.y * S.zoom + S.panY });
const toWorld = (s) => ({ x: (s.x - S.panX) / S.zoom, y: (s.y - S.panY) / S.zoom });

/**
 * Height is normalized to the repo's own p95, not to an absolute scale. The old
 * curve saturated at ~958 lines, so a 1,000-line file and a 5,000-line file drew
 * identical towers — the exact comparison the map exists to make.
 */
const LOC_P95 = (() => {
  const locs = ATLAS.nodes.filter(n => n.kind === "file" && n.loc > 0).map(n => n.loc).sort((a, b) => a - b);
  if (!locs.length) return 1;
  return Math.max(1, locs[Math.min(locs.length - 1, Math.floor(locs.length * 0.95))]);
})();
const LOG_P95 = Math.log1p(LOC_P95);

function heightOf(n) {
  if (n.kind === "datastore") return 84;
  if (n.kind === "endpoint") return 22;
  // Files past p95 stay taller than it rather than being clipped to it, but not
  // without limit: one generated 100k-line file must not flatten the whole map.
  return 8 + Math.min(130 * Math.log1p(n.loc) / LOG_P95, 260);
}
/**
 * The identity channel, and only the identity channel.
 *
 * Identity writes to fill; state writes to stroke, ring, glow and badge. They
 * must be different properties, or turning identity colour off would also turn
 * the selection and the flow highlight off.
 *
 * `mono` therefore drops the layer fill and nothing else. The coverage tint is
 * state — orange means no test reaches this file, which is the honesty contract
 * rendered — so it survives every colour mode. Identity is redundant anyway:
 * services are already rows and layers are already columns, so position carries
 * it without spending the colour budget.
 */
function colorOf(n) {
  if (viewKind(S.view) === "tests" && n.coverage) {
    const tint = COVER_TINT[n.coverage];
    if (tint) return tint;
  }
  if (S.colorMode === "mono") return THEME.face;
  return layerById.get(n.layer)?.color ?? THEME.layerFallback;
}

