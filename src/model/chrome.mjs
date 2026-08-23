/** Views and theme: config-overridable presentation tables the payload ships to the viewer. A view is data, and its `kind` (dataflow/flow/tests/request/findings) is what the viewer branches on; the legend names keys in these tables so a colour has one definition. */

const DEFAULT_HINTS = {
  // `dataflow` is the structure map with its import packets always running: the city and the traffic on it are one view, because a reader should not have to know they are two.
  dataflow:
    "Every file is a block: height and footprint are both file length. Blocks sit in districts — folders by default, or architectural layers — and the diamonds riding the streets are packets on real import edges: one moving from A to B means B reads what A exports. Click a district to open it, a block for its imports and source, a packet mid-flight to read the hop.",
  flow:
    "Each entry is one request path through the code. Packets carry a synthetic payload — click one to read the note attached to that hop.",
  tests:
    "Packets run from each test to what it reaches. Thick edges are a test's primary subject, thin dashed ones are everything else it exercises. Orange blocks: no test reaches them at all.",
  request:
    "Pick an endpoint and compose a request against it. Nothing is sent: this plays the path a request would take through the files — curated where a person asserted one, otherwise derived from the import graph, where dotted hops are gaps derivation could not justify.",
  findings:
    "Structural checks over the graph this map already draws. Pick one and the blocks and imports it names light up in place — the rest of the city dims rather than disappearing. Muted findings are listed, never dropped.",
};

const DEFAULT_TITLES = {
  dataflow: "THE CODEBASE",
  flow: "REQUEST PATH",
  tests: "TEST COVERAGE",
  request: "API REQUEST PATH",
  findings: "STRUCTURAL FINDINGS",
};

export function buildViews(config, flows = [], derived = [], endpoints = []) {
  const flowViews = [...new Set(flows.map((f) => f.view).filter(Boolean))];

  const base = [
    { id: "structure", label: "STRUCTURE", kind: "dataflow" },
    ...flowViews.map((id) => ({
      id,
      label: id.toUpperCase(),
      kind: "flow",
      // The phase watermark is derived from whether this view's flows carry phases.
      showPhase: flows.some((f) => f.view === id && f.phase),
    })),
    { id: "tests", label: "TESTS", kind: "tests" },
    // Derived paths have no view of their own: the composer opens on every endpoint's path, so an inferred one is reached by picking the endpoint rather than by picking a second strip button. The caveat moved onto the hop, which is where a reader is actually looking.
    ...(endpoints.length || derived.length ? [{ id: "request", label: "API REQUEST", kind: "request" }] : []),
    // Unconditional: no findings is a result, and dropping the view would read as "this tool does not check".
    { id: "findings", label: "FINDINGS", kind: "findings" },
  ];

  const withDefaults = (v) => ({ title: DEFAULT_TITLES[v.kind], hint: DEFAULT_HINTS[v.kind], ...v });

  // Config decides order and copy; kind and showPhase still come from the derived entry.
  if (config.views) {
    const byId = new Map(base.map((v) => [v.id, v]));
    const named = config.views.map((v) => withDefaults({ ...byId.get(v.id), ...v }));
    // A config predating a view should not lose it for not listing it.
    const extra = base.filter(
      (v) => (v.kind === "findings" || v.kind === "request") && !config.views.some((c) => c.id === v.id),
    );
    return [...named, ...extra.map(withDefaults)];
  }
  return base.map(withDefaults);
}

/* ── the identity ramp ───────────────────────────────────────────────────────
   Equal-lightness fills stepped by hue, mixed in OKLab so the steps are
   perceptually even rather than even in sRGB — the reason a hand-picked hex
   list drifts in lightness and this one does not. It lives here and not in the
   viewer for the standing reason: canvas cannot read a custom property, so the
   payload is the single place a colour is defined, and config still overrides.
   The viewer indexes into these lists to colour by language or district; the
   values it indexes are always these.                                        */

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gam = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const h2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");

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

/** One material, one light: a face shades by stepping L in OKLab, not by scaling RGB. The viewer carries its own copy of this because a concatenated script cannot import a module; `atlas map` can, so the terminal and the browser light a block by the same arithmetic. */
export function shade(hex, amt) {
  const c = hexToOklab(hex);
  return oklabToHex(Math.max(0.03, Math.min(0.99, c.L + amt * 0.34)), c.a, c.b);
}

/** A hex colour as the three channels a terminal escape wants. */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const oklch = (L, C, hDeg) =>
  oklabToHex(L, C * Math.cos((hDeg * Math.PI) / 180), C * Math.sin((hDeg * Math.PI) / 180));

/** Okabe-Ito: the one preset that is not generated, because it is a fixed set chosen for colour-vision deficiency and interpolating it would undo that. */
const OKABE = ["#e69f00", "#56b4e9", "#009e73", "#d9c531", "#0072b2", "#d55e00", "#cc79a7", "#8a8f98"];

/** One ramp as an ordered list of `n` colours. Deterministic in `n`: the golden files pin these. */
export function rampColors(preset, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (preset === "okabe") out.push(OKABE[i % OKABE.length]);
    else if (preset === "blueprint") out.push(oklch(0.6 + (i / Math.max(1, n - 1)) * 0.24, 0.03, 250));
    else if (preset === "earth") out.push(oklch(0.74, 0.058, 34 + (i / n) * 110));
    else out.push(oklch(0.745, 0.086, (84 + (i * 360) / n) % 360));
  }
  return out;
}

export const RAMP_LABELS = {
  atlas: "atlas ramp",
  blueprint: "neutral blueprint",
  earth: "muted earth",
  okabe: "okabe-ito",
};

/** Every built-in ramp at the length this repo's layer list needs. Floored at 8 so a small repo still gets a ramp wide enough to colour by language or district. */
export function buildRamps(layerCount) {
  const n = Math.max(8, layerCount);
  return Object.fromEntries(Object.keys(RAMP_LABELS).map((k) => [k, rampColors(k, n)]));
}

/** Layer fills from the `atlas` ramp, indexed by the layer's own position in the list. A layer whose config already names a colour keeps it. */
export function paintLayers(layers) {
  const ramp = rampColors("atlas", Math.max(8, layers.length));
  return layers.map((l, i) => (l.color ? l : { ...l, color: ramp[i % ramp.length] }));
}

export const DEFAULT_THEME = {
  ink: "#10131c",
  // A cool paper rather than white: the blocks carry the light, so the ground has to sit below them instead of competing.
  bg: "#eef1f6",
  // A literal stack: canvas ignores var(--mono).
  font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  layerFallback: "#8a8f98",
  // The state channel's one colour: state writes to stroke, ring and badge, never to fill. See PLAN.md "The visual system".
  accent: "#2b4bff",
  // The two greys every plate, outline, halo and watermark is mixed from, at an alpha.
  plate: "#6e7c96",
  edge: "#0d1220",
  // The block face in `mono`; the two vertical faces are shaded down from it.
  face: "#f8fafd",
  packetLabel: "#141a2c",
  // Material switches the renderer, not the palette: `blockShadow`, `faceGradient` and `glow` are on/off per theme, and `gridAlpha` is how far the ground grid sits under the city.
  blockShadow: true,
  faceGradient: true,
  glow: true,
  gridAlpha: 0.15,
  shadow: "rgba(10,14,26,.12)",
  /** The `liquid glass` material's highlight, as three stops down the lit face. Here rather than in the renderer for the same reason every other colour is: canvas cannot read a custom property, so the payload is the one place a colour is written. */
  sheen: ["rgba(255,255,255,.5)", "rgba(255,255,255,.06)", "rgba(255,255,255,0)"],

  edgeStyle: {
    import:           { c: "#6f7358", w: 1,   a: 0.16, dash: null },
    "test:subject":   { c: "#a8542f", w: 1.7, a: 0.55, dash: null },
    "test:exercises": { c: "#a8542f", w: 0.9, a: 0.20, dash: [3, 3] },
    http:             { c: "#8a3a2a", w: 2,   a: 0.75, dash: null },
    sql:              { c: "#3f6a7a", w: 1.2, a: 0.35, dash: null },
    cache:            { c: "#7a5c2c", w: 1.2, a: 0.35, dash: null },
    s3:               { c: "#4a6a4a", w: 1.2, a: 0.35, dash: null },
    coupling:         { c: "#8a3a2a", w: 1.8, a: 0.7,  dash: [6, 4] },
    request:          { c: "#3f5a2c", w: 1.6, a: 0.5,  dash: null },
    response:         { c: "#4a6a7a", w: 1.6, a: 0.5,  dash: null },
    read:             { c: "#3f6a7a", w: 1.4, a: 0.45, dash: null },
    write:            { c: "#8a5a2a", w: 1.6, a: 0.5,  dash: null },
  },

  packetColor: {
    request: "#2f4a1f", response: "#2a4a5a", read: "#2a5a6a", write: "#7a4a10",
    http: "#7a2a1a", cache: "#6a4a1a", s3: "#2a5a3a", import: "#4a4e38",
    "test:subject": "#8a3a1f", "test:exercises": "#8a3a1f", coupling: "#7a2a1a",
  },

  // Coverage tint in the tests view; `direct` keeps its layer colour, so orange means something.
  coverTint: { none: "#b0562f", indirect: "#a89a5c" },

  /** Finding severity for rings and evidence edges. Colour is always the second channel: the chip and panel name the severity in words. */
  findingSeverity: { error: "#b3261e", warning: "#b5730f", info: "#4a7a8c" },

  /** A live response's status class: three classes rather than a gradient, and the only green in the palette, because a status is genuinely observed. */
  liveStatus: { ok: "#2f7d4f", client: "#b5730f", server: "#b3261e" },

  /** The dark theme as a delta: only the scalars flip, and everything mixed from them follows. */
  dark: {
    ink: "#e6e9f5",
    bg: "#0a0d16",
    layerFallback: "#5f6a8c",
    accent: "#6ea8ff",
    plate: "#8b97b8",
    edge: "#dfe6ff",
    face: "#252c42",
    packetLabel: "#e6e9f5",
    gridAlpha: 0.18,
    shadow: "rgba(0,0,0,.38)",
    // Weaker on a near-black ground: the light-theme sheen blows out to a white smear.
    sheen: ["rgba(255,255,255,.26)", "rgba(255,255,255,.04)", "rgba(255,255,255,0)"],
    // Lightened rather than re-hued: a deep red disappears into a near-black ground.
    findingSeverity: { error: "#ff6b5e", warning: "#f0a03c", info: "#79b8d0" },
    liveStatus: { ok: "#5fd08a", client: "#f0a03c", server: "#ff6b5e" },
  },

  // Cell pitch and the gutters between layer columns and service rows; `spacing` must stay above 1 or footprints overlap and the depth sort stops being exact.
  density: {
    default: "normal",
    presets: {
      compact: { spacing: 1.15, gutLayer: 0.5, gutSvc: 0.9 },
      normal: { spacing: 1.25, gutLayer: 1, gutSvc: 1.5 },
      // What every atlas before Phase 2.7 was drawn at.
      roomy: { spacing: 1.5, gutLayer: 2, gutSvc: 2.5 },
    },
  },
  /** Legend rows by view kind; `edge` and `swatch` name a key in the tables above rather than repeat a colour. */
  legend: {
    default: [
      { edge: "import", label: "IMPORT" },
      { edge: "http", label: "CROSS-SERVICE HTTP" },
      { edge: "coupling", label: "SHARED-DB COUPLING" },
      { edge: "sql", label: "SQL / CACHE" },
      { swatch: "request", label: "PACKET — CLICK TO INSPECT" },
    ],
    // The structure map now runs its import packets by default, so the strip has to say what a moving diamond means before a reader asks.
    dataflow: [
      { edge: "import", label: "IMPORT — OBSERVED" },
      { edge: "http", label: "CROSS-SERVICE HTTP" },
      { edge: "coupling", label: "SHARED-DB COUPLING" },
      { edge: "sql", label: "SQL / CACHE" },
      { swatch: "import", label: "PACKET — CLICK TO INSPECT" },
    ],
    // Every row names the severity in words as well as in colour.
    findings: [
      { sev: "error", label: "ERROR" },
      { sev: "warning", label: "WARNING" },
      { sev: "info", label: "INFO" },
      { sev: "warning", dash: true, label: "DASHED — MUTED BY CONFIG, STILL COUNTED" },
    ],
    tests: [
      { edge: "test:subject", label: "TEST COVERS (PRIMARY SUBJECT)" },
      { edge: "test:exercises", label: "ALSO EXERCISES" },
      { layer: "repository", label: "DIRECT — A TEST IMPORTS IT" },
      { tint: "indirect", label: "INDIRECT — REACHED VIA IMPORTS" },
      { tint: "none", label: "NONE — NO TEST REACHES IT" },
    ],
  },
};

/** Shallow-merge per branch: overriding one edge kind must not drop the rest. `layerCount` sizes the ramps, which is why it is a parameter rather than read off a global. */
export function buildTheme(config, layerCount = 0) {
  const t = config.theme ?? {};
  return {
    ...DEFAULT_THEME,
    ...t,
    // Shipped, not generated in the viewer: the payload stays the one place a colour is defined, and the PALETTE panel indexes into these.
    ramps: { ...buildRamps(layerCount), ...t.ramps },
    rampLabels: { ...RAMP_LABELS, ...t.rampLabels },
    edgeStyle: { ...DEFAULT_THEME.edgeStyle, ...t.edgeStyle },
    packetColor: { ...DEFAULT_THEME.packetColor, ...t.packetColor },
    coverTint: { ...DEFAULT_THEME.coverTint, ...t.coverTint },
    findingSeverity: { ...DEFAULT_THEME.findingSeverity, ...t.findingSeverity },
    liveStatus: { ...DEFAULT_THEME.liveStatus, ...t.liveStatus },
    dark: { ...DEFAULT_THEME.dark, ...t.dark },
    density: { ...DEFAULT_THEME.density, ...t.density, presets: { ...DEFAULT_THEME.density.presets, ...t.density?.presets } },
    legend: { ...DEFAULT_THEME.legend, ...t.legend },
  };
}
