/* ═══ helpers ═══ */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => n.toLocaleString("en-US");
const districtId = (service, key) => `${service}/${key}`;

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/* One material, one light: faces shade by stepping L in OKLab, not by scaling RGB. */
const shadeMemo = new Map();
function shade(hex, amt) {
  const k = `${hex}|${amt}`;
  let out = shadeMemo.get(k);
  if (out !== undefined) return out;
  const c = hexToOklab(hex);
  out = oklabToHex(Math.max(0.03, Math.min(0.99, c.L + amt * 0.34)), c.a, c.b);
  shadeMemo.set(k, out);
  return out;
}
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };

let A = { x: HW, y: HW * K }, B = { x: -HW, y: HW * K };
function setYaw(yaw) {
  S.yaw = yaw;
  const d = yaw - YAW0, cd = Math.cos(d), sd = Math.sin(d);
  A = { x: HW * (cd - sd), y: HW * (cd + sd) * K };
  B = { x: -HW * (cd + sd), y: HW * (cd - sd) * K };
}
const project = (gx, gy, h) => ({ x: gx * A.x + gy * B.x, y: gx * A.y + gy * B.y - h });
function unproject(x, y) {
  const det = A.x * B.y - B.x * A.y;
  return { gx: (x * B.y - y * B.x) / det, gy: (y * A.x - x * A.y) / det };
}
const depthOf = (gx, gy) => gx * A.y + gy * B.y;
const screenXOf = (gx, gy) => gx * A.x + gy * B.x;
const toScreen = (w) => ({ x: w.x * S.zoom + S.panX, y: w.y * S.zoom + S.panY });
const toWorld = (s) => ({ x: (s.x - S.panX) / S.zoom, y: (s.y - S.panY) / S.zoom });

const LOC_P95 = (() => {
  const locs = ATLAS.nodes.filter(n => n.kind === "file" && n.loc > 0).map(n => n.loc).sort((a, b) => a - b);
  if (!locs.length) return 1;
  return Math.max(1, locs[Math.min(locs.length - 1, Math.floor(locs.length * 0.95))]);
})();
const LOG_P95 = Math.log1p(LOC_P95);
const EXP_MAX = Math.max(1, ...ATLAS.nodes.map(n => n.exports ?? 0));
const ENDPOINT_OWNERS = new Set((ATLAS.endpoints ?? []).map(e => e.definedIn).filter(Boolean));
function heightOf(n) {
  if (n.kind === "datastore") return 84;
  if (n.kind === "endpoint") return 26;
  if (n.kind === "district") return 26 + Math.min(210 * Math.log1p(n.loc) / (LOG_P95 * 1.35), 300);
  return 8 + Math.min(130 * Math.log1p(n.loc) / LOG_P95, 260);
}
/* Size is LOC in both dimensions: height is log lines, footprint is log lines. */
function footScale(n) {
  const own = S.nodeSizes.get(n.id) ?? 1;
  let base;
  if (n.kind === "endpoint") base = 0.78;
  else if (n.kind === "datastore") base = 0.88;
  else if (n.kind === "district") base = 0.95;
  else base = 0.44 + 0.52 * Math.min(1, Math.log1p(n.loc || 0) / LOG_P95);
  return clamp(base * own, 0.26, 0.98);
}
/* Identity colour: per-block override, then the palette keyed by layer, language or district. */
const LAYER_ORDER = ATLAS.layers.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map(l => l.id);
const LANG_ORDER = [...new Set(ATLAS.nodes.map(n => (n.lang && n.lang !== "-" ? n.lang : "other")))].sort();
const langOf = (n) => (n.lang && n.lang !== "-" ? n.lang : "other");
function colorKeyOf(n) {
  if (S.colorBy === "lang") return langOf(n);
  if (S.colorBy === "district") return n._dk ?? "·";
  return n.layer;
}
let keyListMemo = { k: null, list: [] };
function colorKeyList() {
  const k = `${S.colorBy}|${layoutEpoch}|${LAYOUT.districts?.length ?? 0}`;
  if (keyListMemo.k === k) return keyListMemo.list;
  const list = S.colorBy === "lang" ? LANG_ORDER
    : S.colorBy === "district" ? (LAYOUT.districts ?? []).map(d => d.id).slice().sort()
    : LAYER_ORDER;
  keyListMemo = { k, list };
  return list;
}
/* Order of authority, and it matters: a colour the reader picked, then the
   colour the PAYLOAD carries, then the ramp. The payload only has one for
   layers — `paintLayers()` filled it from this same ramp, or a config named it
   — so honouring it is what stops a config's `layers[].color` from being drawn
   in the sidebar and ignored on the map. Language and district have no shipped
   colour, so they index the ramp; an unknown key hashes to a stable slot. */
function colorForKey(key, list) {
  const ov = S.keyColors.get(`${S.colorBy}:${key}`);
  if (ov) return ov;
  if (S.colorBy === "layer") {
    const shipped = layerById.get(key)?.color;
    if (shipped) return shipped;
  }
  const keys = list ?? colorKeyList();
  const cols = paletteColors();
  const i = keys.indexOf(key);
  return cols[(i < 0 ? Math.abs(fnv(String(key))) : i) % cols.length];
}
function layerColorOf(id) {
  const ov = S.keyColors.get(`layer:${id}`);
  if (ov) return ov;
  const shipped = layerById.get(id)?.color;
  if (shipped) return shipped;
  const cols = paletteColors();
  const i = LAYER_ORDER.indexOf(id);
  return cols[(i < 0 ? 0 : i) % cols.length];
}
function colorOf(n) {
  const own = S.nodeColors.get(n.id);
  if (own) return own;
  if (viewKind(S.view) === "tests" && n.coverage) {
    const tint = COVER_TINT[n.coverage];
    if (tint) return tint;
  }
  if (S.colorMode === "mono") return THEME.face;
  return colorForKey(colorKeyOf(n));
}
function bboxOf(nodes) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const n of nodes) for (const face of n.faces ?? []) for (const p of face.pts) {
    if (p.x < b.x0) b.x0 = p.x;
    if (p.x > b.x1) b.x1 = p.x;
    if (p.y < b.y0) b.y0 = p.y;
    if (p.y > b.y1) b.y1 = p.y;
  }
  return b;
}

/* ═══ grouping: layers, or directories ═══ */
/* The district key in `folder` mode: where the file sits, relative to its own
   service root. Stripping the root matters on a monorepo — without it every
   file under services/api/ shares one prefix and the axis collapses to a
   single column. A file with no subfolder below its root gets "·", and `.`
   normalises to the same thing: the payload writes "." for a repo-root file,
   and two names for "no subfolder" would draw two districts for one idea. */
function groupKeyOf(n) {
  if (S.group !== "folder") return n.layer;
  if (n.kind === "endpoint") return "endpoints";
  const root = svcById.get(n.service)?.root ?? "";
  const dir = n.dir === "." ? "" : n.dir;
  const rel = dir === root ? "" : root && dir.startsWith(root + "/") ? dir.slice(root.length + 1) : dir;
  return rel || "·";
}
function keyCompare(a, b) {
  if (S.group === "folder") {
    if (a === "endpoints") return b === "endpoints" ? 0 : -1;
    if (b === "endpoints") return 1;
    return a.localeCompare(b);
  }
  return (layerById.get(a)?.rank ?? 99) - (layerById.get(b)?.rank ?? 99);
}
function labelForKey(key) {
  if (S.group === "folder") return key;
  return (layerById.get(key)?.label ?? key).toUpperCase();
}
