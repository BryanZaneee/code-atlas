/* ═══ state ═══ */
const REDUCED_MOTION = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const S = {
  view: "structure", theme: "light", colorMode: "identity",
  zoom: 1, panX: 0, panY: 0, yaw: YAW0,
  running: true, speed: 1, stepBudget: 0,
  selected: null, pinnedPacket: null, focusDistrict: null,
  activeFlow: "__all__", finding: null, isolate: true,
  shape: "varied", packing: "grid", density: BASE.density.default, ground: true,
  group: "folder",
  bands: "auto", roads: true, plinths: true, facade: true, material: "solid",
  move: false,
  query: "", services: new Set(ATLAS.services.map(s => s.id)), openServices: new Set(),
  opts: { docs: false, tests: false, contract: true, ambient: !REDUCED_MOTION, labels: true, vendor: false },
  hover: null,
  districtOffsets: new Map(), nodeOffsets: new Map(),
  shapeByDistrict: new Map(), collapsed: new Set(),
  nodeColors: new Map(), nodeShapes: new Map(), nodeSizes: new Map(),
  keyColors: new Map(), palettePreset: "atlas", colorBy: "layer",
  notes: new Map(), insTab: "info",
  dragDistrict: null, dragNode: null, dragCells: { dx: 0, dy: 0 },
  request: null, mode: "mock",
  intro: !REDUCED_MOTION, introOrder: INTRO.order, introT: 1,
};

const byId = new Map(ATLAS.nodes.map(n => [n.id, n]));
const layerById = new Map(ATLAS.layers.map(l => [l.id, l]));
const svcById = new Map(ATLAS.services.map(s => [s.id, s]));
const ALL_FLOWS = [...ATLAS.flows, ...(ATLAS.derivedFlows ?? [])];
const flowById = new Map(ALL_FLOWS.map(f => [f.id, f]));
const edgesFrom = new Map(), edgesTo = new Map();
for (const e of ATLAS.edges) {
  if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
  if (!edgesTo.has(e.to)) edgesTo.set(e.to, []);
  edgesFrom.get(e.from).push(e);
  edgesTo.get(e.to).push(e);
}
