/* ════════════════════ render ════════════════════ */
const cv = $("#cv"), ctx = cv.getContext("2d");
const off = document.createElement("canvas"), octx = off.getContext("2d");
let staticDirty = true, W = 0, H = 0, DPR = 1;

function resize() {
  DPR = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  W = r.width; H = r.height;
  for (const [c, x] of [[cv, ctx], [off, octx]]) {
    c.width = Math.max(1, Math.round(W * DPR));
    c.height = Math.max(1, Math.round(H * DPR));
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  staticDirty = true;
}

function quad(x, pts, fill, stroke) {
  x.beginPath();
  pts.forEach((p, i) => { const s = toScreen(p); i ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y); });
  x.closePath();
  if (fill) { x.fillStyle = fill; x.fill(); }
  if (stroke) { x.strokeStyle = stroke; x.lineWidth = 1; x.stroke(); }
}

function dimOf(n) {
  if (S.query) {
    const q = S.query.toLowerCase();
    if (!n.id.toLowerCase().includes(q) && !(n.name ?? "").toLowerCase().includes(q)) return true;
  }
  if (S.focusDistrict && `${n.service}|${n.layer}` !== S.focusDistrict) return true;
  return false;
}

function drawStatic() {
  octx.clearRect(0, 0, W, H);
  octx.fillStyle = BG; octx.fillRect(0, 0, W, H);

  // service plates, then district plates
  for (const p of LAYOUT.plates) {
    quad(octx, [project(p.x0, p.y0, 0), project(p.x1, p.y0, 0), project(p.x1, p.y1, 0), project(p.x0, p.y1, 0)], "rgba(60,64,40,.075)", "rgba(60,64,40,.16)");
    const s = toScreen(project(p.x0, p.y0, 0));
    octx.save();
    octx.fillStyle = "rgba(35,37,28,.62)";
    octx.font = `600 ${clamp(11 * S.zoom, 8, 15)}px ${FONT}`;
    octx.textAlign = "left";
    octx.fillText(p.label, s.x + 8 * S.zoom, s.y - 5 * S.zoom);
    octx.restore();
  }
  for (const d of LAYOUT.districts) {
    const dim = S.focusDistrict && S.focusDistrict !== d.id;
    quad(octx, [project(d.x0, d.y0, 0), project(d.x1, d.y0, 0), project(d.x1, d.y1, 0), project(d.x0, d.y1, 0)],
      dim ? "rgba(60,64,40,.05)" : "rgba(60,64,40,.13)", "rgba(60,64,40,.2)");
    if (S.zoom > 0.4) {
      const s = toScreen(project(d.x0, d.y1, 0));
      octx.save();
      octx.fillStyle = dim ? "rgba(35,37,28,.28)" : "rgba(35,37,28,.55)";
      octx.font = `${clamp(9 * S.zoom, 7, 12)}px ${FONT}`;
      octx.textAlign = "left";
      octx.fillText(d.label.toLowerCase(), s.x + 5 * S.zoom, s.y + 11 * S.zoom);
      octx.restore();
    }
  }

  // ambient edges sit on the ground, under the boxes
  if (!isFlowView(S.view)) {
    for (const e of LAYOUT.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a?.top || !b?.top) continue;
      const st = EDGE_STYLE[e.kind] ?? EDGE_STYLE.import;
      const faded = dimOf(a) && dimOf(b);
      octx.save();
      octx.globalAlpha = st.a * (faded ? 0.25 : 1);
      octx.strokeStyle = st.c;
      octx.lineWidth = st.w;
      if (st.dash) octx.setLineDash(st.dash.map(v => v * S.zoom));
      const p0 = toScreen(project(a.gx + 0.5, a.gy + 0.5, 0));
      const p1 = toScreen(project(b.gx + 0.5, b.gy + 0.5, 0));
      octx.beginPath(); octx.moveTo(p0.x, p0.y); octx.lineTo(p1.x, p1.y); octx.stroke();
      octx.restore();
    }
  }

  // boxes, painter's order
  const showLabels = S.opts.labels && S.zoom >= 0.55;
  for (const n of LAYOUT.nodes) {
    const dim = dimOf(n);
    const sel = n.id === S.selected;
    const base = colorOf(n);
    octx.save();
    octx.globalAlpha = dim ? 0.16 : 1;
    quad(octx, n.faceLeft,  shade(base, -0.42), "rgba(20,22,16,.28)");
    quad(octx, n.faceRight, shade(base, -0.22), "rgba(20,22,16,.28)");
    quad(octx, n.faceTop,   sel ? THEME.selected : base, sel ? INK : "rgba(20,22,16,.38)");
    octx.restore();
  }

  // Labels in a second pass, nearest first, so a foreground box never paints
  // over a label and colliding labels drop out instead of turning to mush.
  const taken = [];
  const hits = (r) => taken.some(t => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
  for (let i = LAYOUT.nodes.length - 1; i >= 0; i--) {
    const n = LAYOUT.nodes[i];
    const sel = n.id === S.selected;
    const dim = dimOf(n);
    if (!((showLabels && !dim) || sel)) continue;
    const s = toScreen(n.top);
    if (s.x < -80 || s.x > W + 80 || s.y < -20 || s.y > H + 20) continue;
    const size = clamp(10 * S.zoom, 8, 13);
    octx.font = `${sel ? "600 " : ""}${size}px ${FONT}`;
    const w = octx.measureText(n.name).width;
    const box = { x: s.x - w / 2, y: s.y - 5 - size, w, h: size + 3 };
    if (!sel && hits(box)) continue;
    taken.push(box);
    octx.save();
    octx.textAlign = "center";
    octx.lineWidth = 3.5;
    octx.strokeStyle = "rgba(216,214,184,.92)";
    octx.strokeText(n.name, s.x, s.y - 5);
    octx.fillStyle = sel ? INK : "rgba(35,37,28,.92)";
    octx.fillText(n.name, s.x, s.y - 5);
    octx.restore();
  }
  staticDirty = false;
}

function drawArc(x, arc, style, alpha) {
  const a = toScreen(arc.a), b = toScreen(arc.b), c = toScreen({ x: arc.cx, y: arc.cy });
  x.save();
  x.globalAlpha = alpha;
  x.strokeStyle = style.c;
  x.lineWidth = style.w * clamp(S.zoom, 0.6, 1.6);
  if (style.dash) x.setLineDash(style.dash.map(v => v * S.zoom));
  x.beginPath(); x.moveTo(a.x, a.y); x.quadraticCurveTo(c.x, c.y, b.x, b.y); x.stroke();
  x.restore();
}

function drawDiamond(x, p, r, fill) {
  x.beginPath();
  x.moveTo(p.x, p.y - r); x.lineTo(p.x + r, p.y); x.lineTo(p.x, p.y + r); x.lineTo(p.x - r, p.y);
  x.closePath(); x.fillStyle = fill; x.fill();
}

let livePackets = [];   // screen-space, for hit testing

function draw() {
  if (staticDirty) drawStatic();
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(off, 0, 0, W, H);
  livePackets = [];

  // flow arcs above the city so packets are never occluded
  for (const r of runners) {
    r.steps.forEach((s, i) => {
      const cur = i === r.i;
      drawArc(ctx, s.arc, EDGE_STYLE[s.kind] ?? EDGE_STYLE.request, cur ? 0.85 : 0.16);
    });
  }

  for (const p of ambient) {
    const w = bez(p.arc, p.t), s = toScreen(w);
    drawDiamond(ctx, s, clamp(2.6 * S.zoom, 1.6, 4.5), PACKET_COLOR[p.e.kind] ?? PACKET_COLOR.import);
    livePackets.push({ x:s.x, y:s.y, kind:"edge", data:p.e });
  }

  for (const r of runners) {
    const st = r.steps[r.i];
    if (!st) continue;
    const w = bez(st.arc, r.t), s = toScreen(w);
    const col = PACKET_COLOR[st.kind] ?? PACKET_COLOR.request;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    drawDiamond(ctx, s, clamp(5 * S.zoom, 3.5, 8), col);
    ctx.restore();
    ctx.strokeStyle = "rgba(240,238,205,.9)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, clamp(5 * S.zoom, 3.5, 8) + 2, 0, 7); ctx.stroke();
    livePackets.push({ x:s.x, y:s.y, kind:"step", data:st });

    if (st.label && S.zoom > 0.45) {
      ctx.save();
      ctx.font = `${clamp(9 * S.zoom, 8, 12)}px ${FONT}`;
      ctx.textAlign = "center"; ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(216,214,184,.9)";
      ctx.strokeText(st.label, s.x, s.y - 13);
      ctx.fillStyle = THEME.packetLabel;
      ctx.fillText(st.label, s.x, s.y - 13);
      ctx.restore();
    }
  }

  // phase watermark, for a flow view whose flows carry phases
  if (viewById.get(S.view)?.showPhase && runners[0]?.steps[runners[0].i]) {
    const f = flowById.get(runners[0].steps[runners[0].i].flowId);
    if (f) {
      ctx.save();
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = "rgba(35,37,28,.13)";
      ctx.textAlign = "right";
      ctx.fillText(f.phase ?? f.label, W - 18, H - 22);
      ctx.restore();
    }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.running || S.stepBudget > 0) advance(dt);
  draw();
  requestAnimationFrame(frame);
}

