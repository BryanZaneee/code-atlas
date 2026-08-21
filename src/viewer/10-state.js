/* ════════════════════ state ════════════════════ */
// Turns off ambient drift only (a reader-picked flow still plays), which is what lets the render loop go fully idle.
const REDUCED_MOTION = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const S = {
  view: "structure",
  theme: "light",
  colorMode: "identity",
  zoom: 1, panX: 0, panY: 0, yaw: YAW0,
  running: true, speed: 1, stepBudget: 0,
  selected: null,       // node id
  pinnedPacket: null,
  focusDistrict: null,  // "service/layer" — the district id the payload publishes
  activeFlow: "__all__",
  // Overlay state like `selected`: never enters the raster cache, so lighting evidence costs a veil, not a re-raster.
  finding: null,
  // Flow views show only the flow by default; readable alone, locatable in context, so both are offered.
  isolate: true,
  shape: "block",
  packing: "grid",
  density: THEME.density.default,
  ground: true,
  query: "",
  services: new Set(ATLAS.services.map(s => s.id)),
  openServices: new Set(),
  opts: { docs:false, tests:false, contract:true, ambient: !REDUCED_MOTION, labels:true },
  hover: null,
  // Reader-dragged district offsets, in whole cells: an off-lattice offset would overlap footprints and break the depth sort.
  // ponytail: in memory, so a reload returns the computed layout. sessionStorage
  // if arrangements should outlive a refresh — PLAN.md defers persisted layouts,
  // so that is a decision to take rather than a line to add here.
  districtOffsets: new Map(),
  // Live alt-drag overlay: nothing commits until mouseup, so a drag costs a ghost rectangle, not a relayout per move.
  dragDistrict: null,
  dragCells: { dx: 0, dy: 0 },
  // The armed composer path lives on S, not in 78-request.js: 20-select.js reads it when that file may not be loaded.
  request: null,
  // "mock" is a literal, never inferred from reachability: the mode that sends real traffic must never be arrived at by inference.
  mode: "mock",
};

const byId = new Map(ATLAS.nodes.map(n => [n.id, n]));
const layerById = new Map(ATLAS.layers.map(l => [l.id, l]));
const svcById = new Map(ATLAS.services.map(s => [s.id, s]));
// Curated and derived paths share one list; derived entries carry `derived: true` and the canvas says so.
const ALL_FLOWS = [...ATLAS.flows, ...(ATLAS.derivedFlows ?? [])];
const flowById = new Map(ALL_FLOWS.map(f => [f.id, f]));
// District codes come from the scanner, so a plate tab shows something a reader can grep for.
const codeByDistrict = new Map(ATLAS.districts.map(d => [d.id, d.code]));
const edgesFrom = new Map(), edgesTo = new Map();
for (const e of ATLAS.edges) {
  if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
  if (!edgesTo.has(e.to)) edgesTo.set(e.to, []);
  edgesFrom.get(e.from).push(e);
  edgesTo.get(e.to).push(e);
}

