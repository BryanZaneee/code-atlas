/** Views and theme: config-overridable presentation tables the payload ships to the viewer. A view is data, and its `kind` (structure/flow/tests/request/findings) is what the viewer branches on; the legend names keys in these tables so a colour has one definition. */

const DEFAULT_HINTS = {
  structure:
    "Rows are services, columns are architectural layers. Block height is file length. Click a district to open it and list its files.",
  flow:
    "Each entry is one request path through the code. Packets carry a synthetic payload — click one to read the note attached to that hop.",
  tests:
    "Thick edges are a test's primary subject, thin dashed ones are everything else it exercises. Orange blocks have no test referencing them.",
  request:
    "Pick an endpoint and compose a request against it. The payload is synthetic and nothing is sent — this plays the modelled path a request would take, curated first and derived otherwise, with each hop marked by whether an import backs it.",
  findings:
    "Eight structural checks over the graph this map already draws. Pick one and the blocks and imports it names light up in place — the rest of the city dims rather than disappearing. Muted findings are listed, never dropped.",
};

const DEFAULT_TITLES = {
  structure: "THE CODEBASE",
  flow: "REQUEST PATH",
  tests: "TEST COVERAGE",
  request: "COMPOSE A REQUEST",
  findings: "STRUCTURAL FINDINGS",
};

export function buildViews(config, flows = [], derived = [], endpoints = []) {
  const flowViews = [...new Set(flows.map((f) => f.view).filter(Boolean))];

  const base = [
    { id: "structure", label: "STRUCTURE", kind: "structure" },
    ...flowViews.map((id) => ({
      id,
      label: id.toUpperCase(),
      kind: "flow",
      // The phase watermark is derived from whether this view's flows carry phases.
      showPhase: flows.some((f) => f.view === id && f.phase),
    })),
    // Derived paths get their own view, so the strip alone says asserted or inferred.
    ...(derived.length ? [{ id: "derived", label: "DERIVED PATHS", kind: "flow", derived: true }] : []),
    { id: "tests", label: "TESTS", kind: "tests" },
    // Conditional: with no HTTP surface there is nothing to compose against, and an empty composer is not a result.
    ...(endpoints.length ? [{ id: "request", label: "REQUEST", kind: "request" }] : []),
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
      (v) => (v.derived || v.kind === "findings" || v.kind === "request") && !config.views.some((c) => c.id === v.id),
    );
    return [...named, ...extra.map(withDefaults)];
  }
  return base.map(withDefaults);
}

export const DEFAULT_THEME = {
  ink: "#16181a",
  // White, not cream: line art reads cleanest over the brightest ground.
  bg: "#ffffff",
  // A literal stack: canvas ignores var(--mono).
  font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  layerFallback: "#8a8a8a",
  // The state channel's one colour: state writes to stroke, ring and badge, never to fill. See PLAN.md "The visual system".
  accent: "#2563eb",
  // The two greys every plate, outline, halo and watermark is mixed from, at an alpha.
  plate: "#78828a",
  edge: "#11151a",
  // The block face in `mono`; the two vertical faces are shaded down from it.
  face: "#ffffff",
  packetLabel: "#1c1e1f",

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
    ink: "#e8eaec",
    bg: "#0e1011",
    layerFallback: "#7b7f83",
    accent: "#5b8dff",
    plate: "#98a2a9",
    edge: "#e4e8ec",
    face: "#333a3f",
    packetLabel: "#e8eaec",
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

/** Shallow-merge per branch: overriding one edge kind must not drop the rest. */
export function buildTheme(config) {
  const t = config.theme ?? {};
  return {
    ...DEFAULT_THEME,
    ...t,
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
