/**
 * The theme, single-sourced and shipped in the payload.
 *
 * Canvas cannot read CSS custom properties, so the viewer needs real colour
 * values in JS. Previously it had them in two places — the style tables and a
 * hand-written legend that repeated the same ten literals — which could and did
 * drift apart. The legend is generated from these tables now, so a colour has
 * exactly one definition.
 *
 * Config may override any branch of this; `atlas init` will emit it.
 */
export const DEFAULT_THEME = {
  ink: "#23251c",
  bg: "#d8d6b8",
  // A literal stack: canvas ignores var(--mono).
  font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  layerFallback: "#8a8a6a",
  // The state channel's one colour. Identity writes to fill; state writes to
  // stroke, ring and badge, so turning identity colour off cannot also turn the
  // selection off. See PLAN.md, "The visual system".
  accent: "#3f5a2c",
  selected: "#f2ecc0",
  packetLabel: "#2a2c1f",

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
    legend: { ...DEFAULT_THEME.legend, ...t.legend },
  };
}
