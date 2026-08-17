/* ════════════════════ state ════════════════════ */
const S = {
  view: "structure",
  zoom: 1, panX: 0, panY: 0,
  running: true, speed: 1, stepBudget: 0,
  selected: null,       // node id
  pinnedPacket: null,
  focusDistrict: null,  // "service|layer"
  activeFlow: "__all__",
  query: "",
  services: new Set(ATLAS.services.map(s => s.id)),
  opts: { docs:false, tests:false, contract:true, ambient:true, labels:true },
  hover: null,
};

const byId = new Map(ATLAS.nodes.map(n => [n.id, n]));
const layerById = new Map(ATLAS.layers.map(l => [l.id, l]));
const svcById = new Map(ATLAS.services.map(s => [s.id, s]));
const flowById = new Map(ATLAS.flows.map(f => [f.id, f]));
const edgesFrom = new Map(), edgesTo = new Map();
for (const e of ATLAS.edges) {
  if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
  if (!edgesTo.has(e.to)) edgesTo.set(e.to, []);
  edgesFrom.get(e.from).push(e);
  edgesTo.get(e.to).push(e);
}

