/* ════════════════════ helpers ════════════════════ */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => n.toLocaleString("en-US");

function shade(hex, amt) {         // amt<0 darken toward black
  const n = parseInt(hex.slice(1), 16);
  const f = 1 + amt;
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}
const project = (gx, gy, h) => ({ x: (gx - gy) * (TW / 2), y: (gx + gy) * (TH / 2) - h });
const toScreen = (w) => ({ x: w.x * S.zoom + S.panX, y: w.y * S.zoom + S.panY });
const toWorld = (s) => ({ x: (s.x - S.panX) / S.zoom, y: (s.y - S.panY) / S.zoom });

/**
 * Height is normalized to the repo's own p95, not to an absolute scale. The old
 * curve saturated at ~958 lines, so a 1,000-line file and a 5,000-line file drew
 * identical towers — the exact comparison the map exists to make.
 */
const LOC_P95 = (() => {
  const locs = ATLAS.nodes.filter(n => n.kind === "file" && n.loc > 0).map(n => n.loc).sort((a, b) => a - b);
  if (!locs.length) return 1;
  return Math.max(1, locs[Math.min(locs.length - 1, Math.floor(locs.length * 0.95))]);
})();
const LOG_P95 = Math.log1p(LOC_P95);

function heightOf(n) {
  if (n.kind === "datastore") return 84;
  if (n.kind === "endpoint") return 22;
  // Files past p95 stay taller than it rather than being clipped to it, but not
  // without limit: one generated 100k-line file must not flatten the whole map.
  return 8 + Math.min(130 * Math.log1p(n.loc) / LOG_P95, 260);
}
const COVER_TINT = { none:"#b0562f", indirect:"#a89a5c" };
function colorOf(n) {
  const base = layerById.get(n.layer)?.color ?? "#8a8a6a";
  if (S.view === "tests" && n.coverage) return COVER_TINT[n.coverage] ?? base;
  return base;
}

