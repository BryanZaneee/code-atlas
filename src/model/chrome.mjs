/**
 * The chrome the payload ships to the viewer: which views exist, and what
 * colour everything is.
 *
 * Both are presentation tables rather than facts about the repository, both are
 * config-overridable, and both are read once and adjacently when the payload is
 * assembled — a view gaining a legend row touches the two together, which is
 * why they sit in one file rather than two.
 *
 * ---- VIEWS ----
 *
 * The viewer used to hardcode a list of four view ids and branch on two of them
 * by name, which meant a repo whose flows were called anything else silently
 * lost its flow views. A view is data now, and `kind` is what the viewer
 * branches on:
 *
 *   structure  every node, filtered by the sidebar toggles
 *   flow       only the nodes and edges named by this view's curated flows
 *   tests      test edges and coverage tint
 *
 * A flow view is created for every distinct `flows[].view`, so curation adds a
 * view without touching the tool. Config may override any of it by supplying a
 * `views` array with matching ids.
 *
 * ---- THEME ----
 *
 * Canvas cannot read CSS custom properties, so the viewer needs real colour
 * values in JS. Previously it had them in two places — the style tables and a
 * hand-written legend that repeated the same ten literals — which could and did
 * drift apart. The legend is generated from these tables now, so a colour has
 * exactly one definition.
 *
 * Config may override any branch of this; `atlas init` will emit it.
 */

const DEFAULT_HINTS = {
  structure:
    "Rows are services, columns are architectural layers. Building height is file length. Click a district to open it and list its files.",
  flow:
    "Each entry is one request path through the code. Packets carry a synthetic payload — click one to read the note attached to that hop.",
  tests:
    "Thick edges are a test's primary subject, thin dashed ones are everything else it exercises. Orange blocks have no test referencing them.",
};

const DEFAULT_TITLES = { structure: "THE CODEBASE", flow: "REQUEST PATH", tests: "TEST COVERAGE" };

export function buildViews(config, flows = [], derived = []) {
  const flowViews = [...new Set(flows.map((f) => f.view).filter(Boolean))];

  const base = [
    { id: "structure", label: "STRUCTURE", kind: "structure" },
    ...flowViews.map((id) => ({
      id,
      label: id.toUpperCase(),
      kind: "flow",
      // A view whose flows carry phases gets the phase watermark; one whose
      // flows do not, does not. Derived, not declared.
      showPhase: flows.some((f) => f.view === id && f.phase),
    })),
    // Derived paths get their own view rather than joining a curated one:
    // a reader has to be able to tell, from the strip alone, whether what they
    // are about to watch was asserted by a person or inferred by this tool.
    ...(derived.length ? [{ id: "derived", label: "DERIVED PATHS", kind: "flow", derived: true }] : []),
    { id: "tests", label: "TESTS", kind: "tests" },
  ];

  const withDefaults = (v) => ({ title: DEFAULT_TITLES[v.kind], hint: DEFAULT_HINTS[v.kind], ...v });

  // Config, when present, decides the order and the copy; the derived entry
  // still supplies kind and showPhase so a config cannot get those wrong.
  if (config.views) {
    const byId = new Map(base.map((v) => [v.id, v]));
    const named = config.views.map((v) => withDefaults({ ...byId.get(v.id), ...v }));
    // A config that predates derivation should not lose the view because it
    // did not know to list it.
    const extra = base.filter((v) => v.derived && !config.views.some((c) => c.id === v.id));
    return [...named, ...extra.map(withDefaults)];
  }
  return base.map(withDefaults);
}

export const DEFAULT_THEME = {
  ink: "#16181a",
  // White, not cream. The map and the chrome stand on one ground, and a
  // line-art drawing reads cleanest over the brightest one available.
  bg: "#ffffff",
  // A literal stack: canvas ignores var(--mono).
  font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  layerFallback: "#8a8a8a",
  // The state channel's one colour. Identity writes to fill; state writes to
  // stroke, ring and badge, so turning identity colour off cannot also turn the
  // selection off. See PLAN.md, "The visual system".
  accent: "#2563eb",
  // The two greys every plate, outline, label halo and watermark is mixed from,
  // at an alpha. A named token per opacity is thirteen tokens per palette, and
  // that is how the old palette ended up hardcoded across the renderer.
  // Cooled and lightened against the white ground: on cream a warm grey reads
  // as paper, on white it reads as dirt.
  plate: "#78828a",
  edge: "#11151a",
  // The block face in `mono`, where identity fill is off and the stroke
  // carries the whole form. The two vertical faces are shaded down from it.
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

  // Coverage recolours a block in the tests view. `direct` deliberately has no
  // tint: it keeps its layer colour, so orange means something.
  coverTint: { none: "#b0562f", indirect: "#a89a5c" },

  /**
   * The dark theme, as a delta rather than a second palette.
   *
   * Only the scalars flip. Everything mixed from them — plates, outlines, label
   * halos, the watermark — follows, because they are the same token at an
   * alpha. `edge` inverts from near-black to near-white: in a line-art map the
   * stroke carries the whole form, and a dark outline on a dark ground is not a
   * dimmer map, it is no map.
   */
  dark: {
    ink: "#e8eaec",
    bg: "#0e1011",
    layerFallback: "#7b7f83",
    accent: "#5b8dff",
    plate: "#98a2a9",
    edge: "#e4e8ec",
    face: "#333a3f",
    packetLabel: "#e8eaec",
  },

  /**
   * Legend rows, by view kind. `edge` and `swatch` name a key in the tables
   * above rather than repeating its colour, which is what stops the legend and
   * the map from disagreeing.
   */
  legend: {
    default: [
      { edge: "import", label: "IMPORT" },
      { edge: "http", label: "CROSS-SERVICE HTTP" },
      { edge: "coupling", label: "SHARED-DB COUPLING" },
      { edge: "sql", label: "SQL / CACHE" },
      { swatch: "request", label: "PACKET — CLICK TO INSPECT" },
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
    dark: { ...DEFAULT_THEME.dark, ...t.dark },
    legend: { ...DEFAULT_THEME.legend, ...t.legend },
  };
}
