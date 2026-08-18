/**
 * View definitions, derived from the scan and shipped in the payload.
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
