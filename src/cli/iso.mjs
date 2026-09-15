/**
 * `atlas map` — the isometric atlas, drawn in a terminal.
 *
 * The same city the viewer draws, from the same payload, over a character grid
 * instead of a canvas. Two vertical pixels per cell via `▀`: the foreground
 * paints the top half, the background the bottom, which buys double the
 * vertical resolution for the price of one character.
 *
 * It shares no code with the viewer and is not meant to. The projection is
 * three lines of affine arithmetic, and a seam across the ESM/concatenated-
 * script boundary to share three lines costs more than restating them. What it
 * does share is the payload — a public contract — and `shade()`, so a block is
 * lit by the same maths in both.
 *
 * The honesty contract applies unchanged: files, lines and layers are observed
 * and are all this draws. No derived path, no per-hop timing, nothing modelled.
 */
import { shade, hexToRgb } from "../model/chrome.mjs";

/* ── the terminal we were handed ─────────────────────────────────────────── */

/**
 * How much colour this terminal admits to having.
 *
 * A pipe gets `none`, so `atlas map | less` is readable rather than a wall of
 * escapes, and `NO_COLOR` is honoured before anything else is asked.
 */
export function colorMode(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR) return "none";
  if (!stream.isTTY) return "none";
  const term = env.TERM ?? "";
  if (term === "dumb") return "none";
  if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return "truecolor";
  if (/256/.test(term)) return "256";
  return term ? "16" : "none";
}

/** The xterm 6×6×6 cube, which is where a 256-colour terminal keeps anything that is not a named colour. */
const to256 = (r, g, b) => 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);

/** The eight ANSI colours plus their bright halves, as RGB, for nearest-match. */
const ANSI16 = [
  [0, 0, 0], [170, 0, 0], [0, 170, 0], [170, 85, 0], [0, 0, 170], [170, 0, 170], [0, 170, 170], [170, 170, 170],
  [85, 85, 85], [255, 85, 85], [85, 255, 85], [255, 255, 85], [85, 85, 255], [255, 85, 255], [85, 255, 255], [255, 255, 255],
];
function to16(r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < ANSI16.length; i++) {
    const [R, G, B] = ANSI16[i];
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Foreground and background escapes for one rgb, at whatever depth the terminal has. */
function ink(mode, rgb) {
  if (rgb === null) return { fg: "\x1b[39m", bg: "\x1b[49m" };
  const [r, g, b] = rgb;
  if (mode === "truecolor") return { fg: `\x1b[38;2;${r};${g};${b}m`, bg: `\x1b[48;2;${r};${g};${b}m` };
  if (mode === "256") { const c = to256(r, g, b); return { fg: `\x1b[38;5;${c}m`, bg: `\x1b[48;5;${c}m` }; }
  const c = to16(r, g, b);
  return { fg: `\x1b[${c < 8 ? 30 + c : 90 + c - 8}m`, bg: `\x1b[${c < 8 ? 40 + c : 100 + c - 8}m` };
}

/** Without colour, a pixel is how bright it is. Densest last, so a lit face reads as solid. */
const RAMP = " .:-=+*#%@";
const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/* ── layout ──────────────────────────────────────────────────────────────── */

/** File length decides both dimensions, normalised against the 95th percentile so one enormous file cannot flatten the rest. The viewer's formulas, restated. */
function sizers(nodes) {
  const locs = nodes.filter((n) => n.kind === "file" && n.loc > 0).map((n) => n.loc).sort((a, b) => a - b);
  const p95 = locs.length ? Math.max(1, locs[Math.min(locs.length - 1, Math.floor(locs.length * 0.95))]) : 1;
  const logP95 = Math.log1p(p95);
  return {
    height: (n) => (n.kind === "datastore" ? 84
      : n.kind === "endpoint" ? 26
      : n.kind === "district" ? 26 + Math.min((210 * Math.log1p(n.loc || 0)) / (logP95 * 1.35), 300)
      : 8 + Math.min((130 * Math.log1p(n.loc || 0)) / logP95, 260)) / 26,
    foot: (n) => (n.kind === "endpoint" ? 0.78 : n.kind === "datastore" ? 0.88 : n.kind === "district" ? 0.95 : 0.44 + 0.52 * Math.min(1, Math.log1p(n.loc || 0) / logP95)),
  };
}

/**
 * Blocks on a grid: services down, districts across, files packed into a
 * near-square inside each district.
 *
 * Deliberately simpler than the viewer's shelf packer — no barycentre pull, no
 * jitter, no plinths. A terminal has a few thousand cells to say something in,
 * and the thing worth saying is which districts are large.
 */
export function layout(payload, { collapse = false } = {}) {
  const size = sizers(payload.nodes);
  const byId = new Map(payload.nodes.map((n) => [n.id, n]));
  const layerRank = new Map(payload.layers.map((l) => [l.id, l.rank ?? 99]));
  const colorOf = new Map(payload.layers.map((l) => [l.id, l.color]));

  const services = payload.services.slice().sort((a, b) => a.order - b.order)
    .filter((s) => payload.districts.some((d) => d.service === s.id));

  // Size every district first: its own grid is near-square, and the total area decides how wide the map is allowed to run before a service wraps.
  const sized = [];
  for (const svc of services) {
    for (const d of payload.districts.filter((x) => x.service === svc.id)) {
      const members = d.members.map((id) => byId.get(id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!members.length) continue;
      // A megablock is one district drawn as one solid, its height the district's own total. The viewer collapses on request; here it happens when a file would be too small to see.
      const drawn = collapse
        ? [{ id: d.id, name: d.label ?? d.id, layer: d.layer, kind: "district",
             loc: members.reduce((a, n) => a + (n.loc || 0), 0) }]
        : members;
      const cols = Math.max(1, Math.ceil(Math.sqrt(drawn.length)));
      sized.push({ d, svc: svc.id, members: drawn, cols, rows: Math.ceil(drawn.length / cols) });
    }
  }
  if (!sized.length) return { blocks: [], plates: [] };
  const area = sized.reduce((a, p) => a + (p.cols + 1) * (p.rows + 1), 0);
  const T = Math.max(Math.max(...sized.map((p) => p.cols + 1)), Math.round(Math.sqrt(area)));

  const blocks = [];
  const plates = [];
  let row = 0;

  for (const svc of services) {
    const ds = sized.filter((p) => p.svc === svc.id)
      .sort((a, b) => (layerRank.get(a.d.layer) ?? 99) - (layerRank.get(b.d.layer) ?? 99) || a.d.id.localeCompare(b.d.id));
    if (!ds.length) continue;

    // Shelf packing, the viewer's in miniature: fill a band to `T`, then start the next one under the tallest thing in it.
    let col = 0, bandTop = row, bandH = 0;
    for (const p of ds) {
      if (col && col + p.cols + 1 > T) { bandTop += bandH + 1; col = 0; bandH = 0; }
      p.px = col;
      p.py = bandTop;
      col += p.cols + 1;
      bandH = Math.max(bandH, p.rows);
    }
    row = bandTop + bandH + 2;

    for (const p of ds) {
      p.members.forEach((n, i) => {
        blocks.push({
          gx: p.px + (i % p.cols), gy: p.py + Math.floor(i / p.cols),
          id: n.id, name: n.name, layer: n.layer, loc: n.loc, kind: n.kind,
          w: size.foot(n), h: size.height(n),
          color: colorOf.get(n.layer) ?? "#888888",
        });
      });
      plates.push({ id: p.d.id, label: p.d.label,
        x0: p.px - 0.5, y0: p.py - 0.5, x1: p.px + p.cols - 0.5, y1: p.py + p.rows - 0.5 });
    }
  }
  return { blocks, plates };
}

/* ── raster ──────────────────────────────────────────────────────────────── */

/** Classic 2:1 isometric. A half-block subpixel is square, so no aspect correction is needed here. */
const project = (gx, gy, h, t) => ({ x: (gx - gy) * t, y: (gx + gy) * t * 0.5 - h * t * 0.5 });

/** Scanline fill of a convex polygon, clipped to the buffer. Painter's algorithm does the hiding, so there is no depth test to run. */
function fillPoly(buf, W, H, pts, rgb) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(H - 1, Math.floor(maxY - 0.5));
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
        const x = a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    if (lo > hi) continue;
    const x0 = Math.max(0, Math.ceil(lo - 0.5));
    const x1 = Math.min(W - 1, Math.floor(hi - 0.5));
    for (let x = x0; x <= x1; x++) buf[y * W + x] = rgb;
  }
}

/**
 * Draw the city into a pixel buffer `W × H`.
 *
 * Back to front by `gx + gy`, which for boxes on an isometric grid is enough on
 * its own: a nearer block simply paints over a further one, so no depth buffer
 * is built and none is needed.
 */
/** Project once at unit scale to find the extent, then solve the scale that fills the grid. `t` is how many pixels one grid cell earns, which is also how the caller decides whether a file is still worth drawing. */
export function fitScale(model, W, H) {
  let ex0 = Infinity, ex1 = -Infinity, ey0 = Infinity, ey1 = -Infinity;
  for (const b of model.blocks) {
    for (const p of [project(b.gx - 0.5, b.gy - 0.5, 0, 1), project(b.gx + 0.5, b.gy + 0.5, 0, 1),
                     project(b.gx + 0.5, b.gy - 0.5, b.h, 1), project(b.gx - 0.5, b.gy + 0.5, 0, 1)]) {
      if (p.x < ex0) ex0 = p.x;
      if (p.x > ex1) ex1 = p.x;
      if (p.y < ey0) ey0 = p.y;
      if (p.y > ey1) ey1 = p.y;
    }
  }
  const t = Math.max(0.6, Math.min((W - 2) / Math.max(1e-6, ex1 - ex0), (H - 2) / Math.max(1e-6, ey1 - ey0)));
  return { t, ox: -ex0 * t + (W - (ex1 - ex0) * t) / 2, oy: -ey0 * t + (H - (ey1 - ey0) * t) / 2 };
}

function raster(model, W, H) {
  const buf = new Array(W * H).fill(null);
  const { blocks, plates } = model;
  if (!blocks.length) return buf;
  const { t, ox, oy } = fitScale(model, W, H);
  const P = (gx, gy, h) => { const p = project(gx, gy, h, t); return { x: p.x + ox, y: p.y + oy }; };

  // District plates first: they sit on the ground and everything stands on them.
  for (const d of plates) {
    fillPoly(buf, W, H, [P(d.x0, d.y0, 0), P(d.x1, d.y0, 0), P(d.x1, d.y1, 0), P(d.x0, d.y1, 0)], [42, 46, 54]);
  }

  for (const b of blocks.slice().sort((p, q) => (p.gx + p.gy) - (q.gx + q.gy))) {
    const r = b.w / 2;
    const x0 = b.gx - r, x1 = b.gx + r, y0 = b.gy - r, y1 = b.gy + r;
    const z = b.h;
    // The two faces the light does not reach, then the cap. Same shade steps as the viewer's.
    fillPoly(buf, W, H, [P(x0, y1, z), P(x1, y1, z), P(x1, y1, 0), P(x0, y1, 0)], hexToRgb(shade(b.color, -0.42)));
    fillPoly(buf, W, H, [P(x1, y0, z), P(x1, y1, z), P(x1, y1, 0), P(x1, y0, 0)], hexToRgb(shade(b.color, -0.22)));
    fillPoly(buf, W, H, [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], hexToRgb(b.color));
  }
  return buf;
}

/** The pixel buffer as lines of text, two rows of pixels per line. */
function emit(buf, W, H, mode) {
  const out = [];
  for (let y = 0; y < H; y += 2) {
    let line = "";
    let lastFg = "", lastBg = "";
    for (let x = 0; x < W; x++) {
      const top = buf[y * W + x] ?? null;
      const bot = (y + 1 < H ? buf[(y + 1) * W + x] : null) ?? null;
      if (mode === "none") {
        const v = ((top ? luma(top) : 0) + (bot ? luma(bot) : 0)) / 2;
        line += top || bot ? RAMP[Math.min(RAMP.length - 1, Math.max(1, Math.round(v * (RAMP.length - 1))))] : " ";
        continue;
      }
      if (!top && !bot) { if (lastBg) { line += "\x1b[0m"; lastFg = lastBg = ""; } line += " "; continue; }
      const f = ink(mode, top), g = ink(mode, bot);
      if (f.fg !== lastFg) { line += f.fg; lastFg = f.fg; }
      if (g.bg !== lastBg) { line += g.bg; lastBg = g.bg; }
      line += "▀";
    }
    out.push(mode === "none" ? line.replace(/\s+$/, "") : line + (lastFg || lastBg ? "\x1b[0m" : ""));
  }
  // Blank lines top and bottom carry nothing; a map that fits should not be padded out.
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** Layer counts under the map, in the column style `atlas scan` already prints. */
function legend(model, payload, mode, collapsed = false) {
  const count = new Map();
  for (const b of model.blocks) count.set(b.layer, (count.get(b.layer) ?? 0) + 1);
  const rows = payload.layers.filter((l) => count.has(l.id));
  if (!rows.length) return [];
  return [`  ${collapsed ? "districts" : "blocks"} by layer`, ...rows.map((l) => {
    const swatch = mode === "none" ? "#" : `${ink(mode, hexToRgb(l.color)).fg}██\x1b[0m`;
    return `  ${swatch} ${String(count.get(l.id)).padStart(4)} ${l.label ?? l.id}`;
  })];
}

/**
 * The whole thing: a header, the map, a legend.
 *
 * `width` and `height` are in character cells. Pinning them is what makes the
 * golden test possible, so they are parameters rather than reads of the tty.
 */
export function renderMap(payload, { width = 100, height = 30, mode = "truecolor", collapse = null } = {}) {
  const W = Math.max(20, width);
  const H = Math.max(8, height) * 2;
  const m = payload.meta;
  // The same two lines `report()` leads with, and for the same reason: which rung
  // acquired the tree decides whether this picture is reproducible from a commit.
  const a = m.acquisition ?? {};
  const head = [
    `atlas: ${m.repo} · ${a.mode ?? "fs"} ${a.ref ?? ""}${a.commit ? ` @ ${a.commit}` : " uncommitted"}${a.dirty ? " · DIRTY" : ""}`,
    `atlas: ${m.fileCount} files, ${m.lineCount} lines, ${m.edgeCount} edges, ${m.endpointCount} endpoints`,
  ];

  // One block per file, unless a file would land on fewer pixels than it takes to
  // read as a solid. Then the map says so and draws districts instead — the same
  // megablock the viewer collapses to, and its height is still the lines it holds.
  let model = layout(payload, { collapse: collapse === true });
  let collapsed = collapse === true;
  if (collapse === null && model.blocks.length && fitScale(model, W, H).t < 2.4) {
    model = layout(payload, { collapse: true });
    collapsed = true;
  }
  if (!model.blocks.length) return [...head, "", "  nothing to draw — no file survived the walk and the filters", ""].join("\n");
  if (collapsed) head.push(`atlas: districts, not files — ${m.fileCount} blocks will not fit ${W}x${height}. Each solid is one district, its height that district's lines.`);

  return [...head, "", ...emit(raster(model, W, H), W, H, mode), "", ...legend(model, payload, mode, collapsed), ""].join("\n");
}
