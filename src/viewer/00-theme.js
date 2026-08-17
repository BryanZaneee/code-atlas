/* ════════════════════ constants ════════════════════ */
const TW = 64, TH = 32;                 // 2:1 isometric tile
// The iso diamond is always 2:1 no matter how the grid is arranged, so the only
// lever on legibility is total cell count. Boxes are 1 cell; SPACING leaves the
// remainder as the gap, and it must stay > 1 or footprints overlap and the
// gx+gy depth sort stops being exact.
const SPACING = 1.5, GUT_LAYER = 2, GUT_SVC = 2.5;
const INK = "#23251c", BG = "#d8d6b8";
// Canvas ignores CSS custom properties, so the stack has to be literal here.
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const EDGE_STYLE = {
  import:            { c:"#6f7358", w:1,   a:0.16, dash:null },
  "test:subject":    { c:"#a8542f", w:1.7, a:0.55, dash:null },
  "test:exercises":  { c:"#a8542f", w:0.9, a:0.20, dash:[3,3] },
  http:              { c:"#8a3a2a", w:2,   a:0.75, dash:null },
  sql:               { c:"#3f6a7a", w:1.2, a:0.35, dash:null },
  cache:             { c:"#7a5c2c", w:1.2, a:0.35, dash:null },
  s3:                { c:"#4a6a4a", w:1.2, a:0.35, dash:null },
  coupling:          { c:"#8a3a2a", w:1.8, a:0.7,  dash:[6,4] },
  request:           { c:"#3f5a2c", w:1.6, a:0.5,  dash:null },
  response:          { c:"#4a6a7a", w:1.6, a:0.5,  dash:null },
  read:              { c:"#3f6a7a", w:1.4, a:0.45, dash:null },
  write:             { c:"#8a5a2a", w:1.6, a:0.5,  dash:null },
};
const PACKET_COLOR = {
  request:"#2f4a1f", response:"#2a4a5a", read:"#2a5a6a", write:"#7a4a10",
  http:"#7a2a1a", cache:"#6a4a1a", s3:"#2a5a3a", import:"#4a4e38",
  "test:subject":"#8a3a1f", "test:exercises":"#8a3a1f", coupling:"#7a2a1a",
};

const VIEWS = [
  { id:"structure",  label:"STRUCTURE" },
  { id:"api",        label:"API FLOW" },
  { id:"engagement", label:"ENGAGEMENT" },
  { id:"tests",      label:"TESTS" },
];

