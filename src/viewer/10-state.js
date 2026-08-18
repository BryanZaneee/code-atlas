/* ════════════════════ state ════════════════════ */
const S = {
  view: "structure",
  theme: "light",
  colorMode: "identity",
  zoom: 1, panX: 0, panY: 0, yaw: YAW0,
  running: true, speed: 1, stepBudget: 0,
  selected: null,       // node id
  pinnedPacket: null,
  focusDistrict: null,  // "service|layer"
  activeFlow: "__all__",
  // Flow views show ONLY the flow by default. Off by choice, not by accident:
  // seeing the path alone is what makes it readable, and seeing it inside the
  // whole map is what makes it locatable. Both are wanted, so both exist.
  isolate: true,
  shape: "block",
  layout: "grid",
  grid: true,
  query: "",
  services: new Set(ATLAS.services.map(s => s.id)),
  openServices: new Set(),
  opts: { docs:false, tests:false, contract:true, ambient:true, labels:true },
  hover: null,
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
const codeByGroup = new Map(ATLAS.groups.map(g => [g.id, g.code]));
const edgesFrom = new Map(), edgesTo = new Map();
for (const e of ATLAS.edges) {
  if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
  if (!edgesTo.has(e.to)) edgesTo.set(e.to, []);
  edgesFrom.get(e.from).push(e);
  edgesTo.get(e.to).push(e);
}

