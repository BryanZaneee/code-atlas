/* ════════════════════ constants ════════════════════ */
const TW = 64, TH = 32;                 // 2:1 isometric tile
const HW = TW / 2;                      // half-width of a ground cell, in screen px
const K = TH / TW;                      // 0.5 — the vertical squash, held fixed
const YAW0 = Math.PI / 4;               // the classic isometric angle
const YAW_STEP = Math.PI / 12;          // 15° per keypress
// Density preset, written by setDensity(); must stay > 1 or footprints overlap and the depth sort stops being exact.
let SPACING = 1.5, GUT_LAYER = 2, GUT_SVC = 2.5;

// Below 1 a footprint spills out of its cell and hit testing starts disagreeing with what was drawn.
const SPACING_MIN = 1.05;

/** Block shapes as stacked prisms; `pts` never leaves the unit cell, or the depth sort breaks. One geometry for renderer, picker and hull. */
const inset = (m) => [[m, m], [1 - m, m], [1 - m, 1 - m], [m, 1 - m]];
const ngon = (k, r) => Array.from({ length: k }, (_, i) => {
  const a = (i / k) * Math.PI * 2 + Math.PI / k;
  return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r];
});

const SHAPES = {
  block:   { label: "BLOCK",   hs: 1,    prisms: [{ pts: inset(0), z0: 0, z1: 1 }] },
  tower:   { label: "TOWER",   hs: 1.5,  prisms: [{ pts: inset(0.24), z0: 0, z1: 1 }] },
  slab:    { label: "SLAB",    hs: 0.45, prisms: [{ pts: inset(0), z0: 0, z1: 1 }] },
  stepped: { label: "STEPPED", hs: 1,    prisms: [
    { pts: inset(0),    z0: 0,    z1: 0.34 },
    { pts: inset(0.14), z0: 0.34, z1: 0.67 },
    { pts: inset(0.28), z0: 0.67, z1: 1 },
  ] },
  round:   { label: "ROUND",   hs: 1,    prisms: [{ pts: ngon(8, 0.5), z0: 0, z1: 1 }] },
};
const SHAPE_IDS = Object.keys(SHAPES);

// Canvas cannot read CSS custom properties, so these arrive from the payload; they are defined in src/model/chrome.mjs, never here.
let THEME = ATLAS.theme;
let INK = THEME.ink, BG = THEME.bg;
const FONT = THEME.font;

const DENSITY = THEME.density;
const DENSITY_IDS = Object.keys(DENSITY.presets);

/** Write the three spacing levers from a named preset. Unknown name -> default. */
function setDensity(name) {
  const p = DENSITY.presets[name] ?? DENSITY.presets[DENSITY.default];
  SPACING = Math.max(SPACING_MIN, p.spacing);
  GUT_LAYER = Math.max(0, p.gutLayer);
  GUT_SVC = Math.max(0, p.gutSvc);
}
const EDGE_STYLE = THEME.edgeStyle;
const PACKET_COLOR = THEME.packetColor;
const COVER_TINT = THEME.coverTint;

/** Dark is a delta over the base palette. Touches no DOM: the caller sets `data-theme` and marks the raster dirty. */
function applyTheme(mode) {
  THEME = mode === "dark" ? { ...ATLAS.theme, ...ATLAS.theme.dark } : ATLAS.theme;
  INK = THEME.ink;
  BG = THEME.bg;
}

const VIEWS = ATLAS.views;
const viewById = new Map(VIEWS.map(v => [v.id, v]));
const viewKind = (id) => viewById.get(id)?.kind ?? "structure";
const isFlowView = (id) => viewKind(id) === "flow";
// Isolation, dimming, packets and stepping key off this rather than "flow", so the request view gets that machinery too.
const playsFlow = (id) => isFlowView(id) || viewKind(id) === "request";

