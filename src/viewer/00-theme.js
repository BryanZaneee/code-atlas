/* ════════════════════ constants ════════════════════ */
const TW = 64, TH = 32;                 // 2:1 isometric tile
const HW = TW / 2;                      // half-width of a ground cell, in screen px
const K = TH / TW;                      // 0.5 — the vertical squash, held fixed
const YAW0 = Math.PI / 4;               // the classic isometric angle
const YAW_STEP = Math.PI / 12;          // 15° per keypress
// The iso diamond is always 2:1 no matter how the grid is arranged, so the only
// lever on legibility is total cell count. Boxes are 1 cell; SPACING leaves the
// remainder as the gap, and it must stay > 1 or footprints overlap and the
// depth sort stops being exact.
const SPACING = 1.5, GUT_LAYER = 2, GUT_SVC = 2.5;

/**
 * Block shapes, as a list of prisms.
 *
 * One shape is a stack of extruded footprints: `pts` is a convex polygon in the
 * unit cell, `z0`/`z1` are fractions of the block's height. A plain box is one
 * prism over the whole cell; a stepped form is three, each inset a little more.
 * Generalising to prisms rather than special-casing each silhouette is what
 * keeps hit testing, the selection hull and the renderer reading the SAME
 * geometry — three places that fall out of agreement the moment a shape is
 * drawn from anything but the faces the picker tests.
 *
 * Footprints stay inside the unit cell on purpose: SPACING > 1 is what makes
 * the depth sort exact, and a shape wider than its cell would break it.
 */
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

// Everything below comes from the payload. Canvas cannot read CSS custom
// properties, so the viewer needs real values in JS — but it must not be the
// place they are DEFINED, or the tool ends up knowing one repository's palette
// and one repository's view names. See src/model/chrome.mjs.
let THEME = ATLAS.theme;
let INK = THEME.ink, BG = THEME.bg;
const FONT = THEME.font;
const EDGE_STYLE = THEME.edgeStyle;
const PACKET_COLOR = THEME.packetColor;
const COVER_TINT = THEME.coverTint;

/**
 * Dark is a delta over the base palette, not a second one: only the scalars
 * flip, and everything mixed from them at an alpha follows. Nothing here
 * touches the DOM, because this file runs before there is one — the caller
 * sets `data-theme` and marks the raster dirty.
 */
function applyTheme(mode) {
  THEME = mode === "dark" ? { ...ATLAS.theme, ...ATLAS.theme.dark } : ATLAS.theme;
  INK = THEME.ink;
  BG = THEME.bg;
}

const VIEWS = ATLAS.views;
const viewById = new Map(VIEWS.map(v => [v.id, v]));
const viewKind = (id) => viewById.get(id)?.kind ?? "structure";
const isFlowView = (id) => viewKind(id) === "flow";

