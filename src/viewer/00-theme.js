/* ════════════════════ constants ════════════════════ */
const TW = 64, TH = 32;                 // 2:1 isometric tile
// The iso diamond is always 2:1 no matter how the grid is arranged, so the only
// lever on legibility is total cell count. Boxes are 1 cell; SPACING leaves the
// remainder as the gap, and it must stay > 1 or footprints overlap and the
// depth sort stops being exact.
const SPACING = 1.5, GUT_LAYER = 2, GUT_SVC = 2.5;

// Everything below comes from the payload. Canvas cannot read CSS custom
// properties, so the viewer needs real values in JS — but it must not be the
// place they are DEFINED, or the tool ends up knowing one repository's palette
// and one repository's view names. See src/model/theme.mjs and views.mjs.
const THEME = ATLAS.theme;
const INK = THEME.ink, BG = THEME.bg;
const FONT = THEME.font;
const EDGE_STYLE = THEME.edgeStyle;
const PACKET_COLOR = THEME.packetColor;
const COVER_TINT = THEME.coverTint;

const VIEWS = ATLAS.views;
const viewById = new Map(VIEWS.map(v => [v.id, v]));
const viewKind = (id) => viewById.get(id)?.kind ?? "structure";
const isFlowView = (id) => viewKind(id) === "flow";

