/* ═══ packets ═══ */
let runners = [], ambient = [], pulses = [];
function arcFor(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  return { a, b, dist, lift: 26 + dist * 0.18, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 - (26 + dist * 0.18) };
}
function bez(arc, t) {
  const u = 1 - t;
  return { x: u * u * arc.a.x + 2 * u * t * arc.cx + t * t * arc.b.x,
           y: u * u * arc.a.y + 2 * u * t * arc.cy + t * t * arc.b.y };
}
function buildPackets() {
  runners = []; ambient = []; pulses = [];
  const placed = LAYOUT.ids;
  const fs = activeFlows();
  if (fs.length) for (const f of fs) {
    const steps = f.steps.map((s, i) => ({ ...s, i, flowId: f.id })).filter(s => placed.has(s.from) && placed.has(s.to));
    if (!steps.length) continue;
    for (const s of steps) s.arc = arcFor(byId.get(s.from).top, byId.get(s.to).top);
    runners.push({ steps, i: 0, t: 0, trail: [] });
    if (steps.length > 6) runners.push({ steps, i: Math.floor(steps.length / 2), t: 0, trail: [] });
  }
  const dfl = viewKind(S.view) === "dataflow";
  if (S.opts.ambient && !playsFlow(S.view) && !findSelected()) {
    const pool = LAYOUT.edges.filter(e => e.kind === "import" || e.kind.startsWith("test:"));
    const n = Math.min(dfl ? 140 : 90, pool.length * (dfl ? 3 : 1));
    for (let i = 0; i < n; i++) {
      const e = pool[Math.floor((i * 7919) % pool.length)];
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a?.top || !b?.top) continue;
      ambient.push({ e, arc: arcFor(a.top, b.top), t: (i * 0.137) % 1, speed: (dfl ? 44 : 26) + (i % 5) * 6 });
    }
  }
}
function renderCaption() {
  const bar = $("#caption");
  const r = runners[0];
  const st = r?.steps[r.i];
  if (!st) { bar.style.opacity = 0; return; }
  const from = byId.get(st.from)?.name ?? st.from;
  const to = byId.get(st.to)?.name ?? st.to;
  const parts = [`step ${r.i + 1}/${r.steps.length}`, `${from} → ${to}`];
  if (st.label) parts.push(st.label);
  bar.textContent = parts.join(" · ");
  bar.style.opacity = 1;
}
function advance(dt) {
  const sp = S.speed;
  for (const p of ambient) {
    p.t += (dt * p.speed * sp) / Math.max(60, p.arc.dist);
    if (p.t > 1) p.t -= 1;
  }
  for (const r of runners) {
    const st = r.steps[r.i];
    if (!st) { r.i = 0; continue; }
    const w = bez(st.arc, r.t);
    r.trail.push({ x: w.x, y: w.y });
    if (r.trail.length > 15) r.trail.shift();
    r.t += (dt * 150 * sp) / Math.max(80, st.arc.dist);
    if (r.t >= 1) {
      const dest = byId.get(st.to);
      if (dest?.top && !REDUCED_MOTION) pulses.push({ x: dest.top.x, y: dest.top.y, t: 0, c: PACKET_COLOR[st.kind] ?? PACKET_COLOR.request });
      r.t = 0;
      r.i = (r.i + 1) % r.steps.length;
      if (r === runners[0]) renderCaption();
      if (S.stepBudget > 0) {
        S.stepBudget = 0; S.running = false;
        selectStep(r.steps[(r.i - 1 + r.steps.length) % r.steps.length]);
        syncControls();
      }
    }
  }
}
