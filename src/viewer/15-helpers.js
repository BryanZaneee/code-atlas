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

function heightOf(n) {
  if (n.kind === "datastore") return 84;
  if (n.kind === "endpoint") return 22;
  return 8 + Math.min(Math.sqrt(n.loc) * 4.2, 130);
}
const COVER_TINT = { none:"#b0562f", indirect:"#a89a5c" };
function colorOf(n) {
  const base = layerById.get(n.layer)?.color ?? "#8a8a6a";
  if (S.view === "tests" && n.coverage) return COVER_TINT[n.coverage] ?? base;
  return base;
}

