/* ════════════════════ state ════════════════════ */
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
  // The finding whose evidence is lit on the map, by id. Overlay state, like
  // `selected` — it never enters the raster cache, so picking one costs a veil
  // and a handful of blocks rather than a re-rasterised city.
  finding: null,
  // Flow views show ONLY the flow by default. Off by choice, not by accident:
  // seeing the path alone is what makes it readable, and seeing it inside the
  // whole map is what makes it locatable. Both are wanted, so both exist.
  isolate: true,
  shape: "block",
  packing: "grid",
  density: THEME.density.default,
  ground: true,
  query: "",
  services: new Set(ATLAS.services.map(s => s.id)),
  openServices: new Set(),
  opts: { docs:false, tests:false, contract:true, ambient:true, labels:true },
  hover: null,
  // Where a reader has dragged a district to, in whole cells, keyed by district
  // id. Whole cells because a block's footprint is one cell: an offset off the
  // lattice would let footprints overlap and break the depth sort, so the drag
  // snaps rather than trusting the mouse.
  //
  // ponytail: in memory, so a reload returns the computed layout. sessionStorage
  // if arrangements should outlive a refresh — PLAN.md defers persisted layouts,
  // so that is a decision to take rather than a line to add here.
  districtOffsets: new Map(),
  // The district under an alt-drag, and how far it has been pulled so far. Live
  // overlay state: nothing is committed until the mouse comes up, so a drag in
  // progress costs a ghost rectangle rather than a relayout per mouse move.
  dragDistrict: null,
  dragCells: { dx: 0, dy: 0 },
  // The armed request-composer path (Phase 8). Lives on S rather than as a
  // top-level binding in 78-request.js: test/render.test.mjs loads 20-select.js
  // without 78-request.js, and activeFlows() there reads S.request whenever the
  // view is "request" — a binding scoped to the not-yet-loaded file would throw
  // a ReferenceError with a stack pointing at neither file. null until a
  // composed request is sent, so this is inert everywhere it is not used.
  request: null,
};

const byId = new Map(ATLAS.nodes.map(n => [n.id, n]));
const layerById = new Map(ATLAS.layers.map(l => [l.id, l]));
const svcById = new Map(ATLAS.services.map(s => [s.id, s]));
// Curated and derived paths play through the same machinery, so the viewer
// reads one list — but every derived entry carries `derived: true`, and the
// chrome says so on the canvas rather than only in a panel.
const ALL_FLOWS = [...ATLAS.flows, ...(ATLAS.derivedFlows ?? [])];
const flowById = new Map(ALL_FLOWS.map(f => [f.id, f]));
// Districts are laid out here but named by the scanner, so the code a plate tab
// shows is the same one the payload published and a reader can grep for.
const codeByDistrict = new Map(ATLAS.districts.map(d => [d.id, d.code]));
const edgesFrom = new Map(), edgesTo = new Map();
for (const e of ATLAS.edges) {
  if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
  if (!edgesTo.has(e.to)) edgesTo.set(e.to, []);
  edgesFrom.get(e.from).push(e);
  edgesTo.get(e.to).push(e);
}

