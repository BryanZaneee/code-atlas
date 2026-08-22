/* ═══ constants ═══ */
const TW = 64, TH = 32, HW = TW / 2, K = TH / TW;
const YAW0 = Math.PI / 4, YAW_STEP = Math.PI / 12;
let SPACING = 1.5, GUT_LAYER = 2, GUT_SVC = 2.5;
const SPACING_MIN = 1.05;

const inset = (m) => [[m, m], [1 - m, m], [1 - m, 1 - m], [m, 1 - m]];
const ngon = (k, r) => Array.from({ length: k }, (_, i) => {
  const a = (i / k) * Math.PI * 2 + Math.PI / k;
  return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r];
});
const SHAPES = {
  block:   { label: "BLOCK",   hs: 1,    prisms: [{ pts: inset(0), z0: 0, z1: 1 }] },
  tower:   { label: "TOWER",   hs: 1.5,  prisms: [{ pts: inset(0.24), z0: 0, z1: 1 }] },
  slab:    { label: "SLAB",    hs: 0.45, prisms: [{ pts: inset(0), z0: 0, z1: 1 }] },
  pad:     { label: "PAD",     hs: 0.3,  prisms: [{ pts: inset(0.06), z0: 0, z1: 1 }] },
  stepped: { label: "STEPPED", hs: 1, prisms: [
    { pts: inset(0), z0: 0, z1: 0.34 },
    { pts: inset(0.14), z0: 0.34, z1: 0.67 },
    { pts: inset(0.28), z0: 0.67, z1: 1 } ] },
  spire:   { label: "SPIRE",   hs: 1.3, prisms: [
    { pts: inset(0.08), z0: 0, z1: 0.55 },
    { pts: inset(0.3), z0: 0.55, z1: 1 } ] },
  round:   { label: "ROUND",   hs: 1, prisms: [{ pts: ngon(8, 0.5), z0: 0, z1: 1 }] },
  hex:     { label: "HEX",     hs: 1, prisms: [{ pts: ngon(6, 0.5), z0: 0, z1: 1 }] },
  /* kind vocabulary (U4.1) — shape carries the kind, so mono keeps it */
  mast:    { label: "MAST",    hs: 0.62, prisms: [
    { pts: inset(0.04), z0: 0, z1: 0.22 },
    { pts: inset(0.42), z0: 0.22, z1: 1 } ] },
  tank:    { label: "TANK",    hs: 0.9, prisms: [{ pts: ngon(8, 0.46), z0: 0, z1: 1 }] },
  sheet:   { label: "SHEET",   hs: 0.14, prisms: [{ pts: inset(0.02), z0: 0, z1: 1 }] },
};
const SHAPE_IDS = Object.keys(SHAPES);
const VARIED_POOL = ["block", "tower", "stepped", "spire"];
const STYLE_POOL = ["block", "tower", "stepped", "round"];   // the shape control now styles file nodes only
const KIND_SHAPE = { endpoint: "mast", datastore: "tank", district: "stepped" };

const BASE = ATLAS.theme;
const FONT = BASE.font;
const DENSITY = BASE.density;
const DENSITY_IDS = Object.keys(DENSITY.presets);
const ASPECT = { target: 1.6, maxBands: 3 };
const INTRO = { order: "depth", ms: 900 };
const PLINTH_STEP = 13;

/* ═══ colour ═══ */
/* OKLab conversion, kept viewer-side on purpose: shading a face is rendering,
   not palette. `shade()` steps L on a colour the payload already chose, which
   is what makes one block read as one material under one light instead of as
   three flat tones. Deciding WHICH colours exist is a different job and lives
   in src/model/chrome.mjs. */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gam = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const h2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return { L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
           a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
           b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s };
}
function oklabToHex(L, a, bb) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return `#${h2(gam(clamp01(r)))}${h2(gam(clamp01(g)))}${h2(gam(clamp01(b)))}`;
}

/* The ramps are NOT generated here. They are mixed in OKLab by
   src/model/chrome.mjs and ride in on the payload, because canvas cannot read
   a CSS custom property and a colour with two definitions eventually has two
   values. This file only chooses which shipped colour to use; a palette the
   reader saves is an override on top, and COPY CONFIG turns one back into the
   config block that would ship it. */
const BUILTIN_PALETTES = BASE.ramps ?? {};
const PALETTE_LABEL = BASE.rampLabels ?? {};
const CUSTOM_KEY = "codeAtlas:palettes";
let CUSTOM_PALETTES = (() => {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "{}") ?? {}; } catch { return {}; }
})();
function saveCustomPalettes() {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(CUSTOM_PALETTES)); } catch { }
}
const allPalettes = () => ({ ...BUILTIN_PALETTES, ...CUSTOM_PALETTES });
const paletteColors = () => allPalettes()[S.palettePreset] ?? BUILTIN_PALETTES.atlas ?? [THEME.layerFallback];

/* ═══ skin ═══ */
let THEME = BASE, INK = BASE.ink, BG = BASE.bg;
let EDGE_STYLE = BASE.edgeStyle, PACKET_COLOR = BASE.packetColor, COVER_TINT = BASE.coverTint;

/** Dark is a delta over the base palette, and every scalar it needs is already on the payload. Touches no DOM: the caller sets `data-theme` and marks the raster dirty. */
function applyTheme(mode) {
  const t = mode === "dark" ? { ...BASE, ...BASE.dark } : { ...BASE };
  THEME = t; INK = t.ink; BG = t.bg;
  EDGE_STYLE = t.edgeStyle; PACKET_COLOR = t.packetColor; COVER_TINT = t.coverTint;
}

function setDensity(name) {
  const p = DENSITY.presets[name] ?? DENSITY.presets[DENSITY.default];
  SPACING = Math.max(SPACING_MIN, p.spacing);
  GUT_LAYER = Math.max(0, p.gutLayer);
  GUT_SVC = Math.max(0, p.gutSvc);
}

const VIEWS = ATLAS.views;
const viewById = new Map(VIEWS.map(v => [v.id, v]));
const viewKind = (id) => viewById.get(id)?.kind ?? "structure";
const isFlowView = (id) => viewKind(id) === "flow";
const playsFlow = (id) => isFlowView(id) || viewKind(id) === "request";
const isCityKind = (k) => k === "structure" || k === "findings" || k === "dataflow";

/* ═══ per-node shapes: kind first, then the style control (U4.1) ═══ */
function shapeIdFor(n) {
  const own = S.nodeShapes.get(n.id);
  if (own) return own;
  const ov = n._dk ? S.shapeByDistrict.get(n._dk) : null;
  if (ov) return ov;
  if (KIND_SHAPE[n.kind]) return KIND_SHAPE[n.kind];
  if (n.layer === "test") return "slab";
  if (n.lang === "md" || n.layer === "docs") return "sheet";
  if (S.shape !== "varied") return S.shape;
  return VARIED_POOL[fnv(n._dk ?? "") % VARIED_POOL.length];
}
const shapeFor = (n) => SHAPES[shapeIdFor(n)] ?? SHAPES.block;
