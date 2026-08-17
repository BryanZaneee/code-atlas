/* ════════════════════ interaction ════════════════════ */
let dragging = false, lastX = 0, lastY = 0, moved = 0;

cv.addEventListener("mousedown", (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; cv.classList.add("drag"); });
window.addEventListener("mouseup", () => { dragging = false; cv.classList.remove("drag"); });
window.addEventListener("mousemove", (e) => {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    S.panX += dx; S.panY += dy; lastX = e.clientX; lastY = e.clientY;
    staticDirty = true;
    return;
  }
  const r = cv.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { $("#tip").style.opacity = 0; return; }
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const p = pickPacket(sx, sy);
  const n = p ? null : pickNode(sx, sy);
  const tip = $("#tip");
  if (p) {
    tip.textContent = p.kind === "step"
      ? `${p.data.label ?? p.data.kind} — click for payload`
      : `${byId.get(p.data.from)?.name} → ${byId.get(p.data.to)?.name}`;
  } else if (n) {
    tip.textContent = n.kind === "file" ? `${n.id} · ${n.loc} lines` : n.id;
  }
  if (p || n) {
    tip.style.opacity = 1;
    tip.style.left = (sx + 14) + "px";
    tip.style.top = (sy + 14) + "px";
  } else tip.style.opacity = 0;
});
cv.addEventListener("click", (e) => {
  if (moved > 4) return;
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const p = pickPacket(sx, sy);
  if (p) {
    if (p.kind === "step") selectStep(p.data);
    else { S.pinnedPacket = null; S.selected = p.data.to; renderInspect(); staticDirty = true; }
    return;
  }
  const n = pickNode(sx, sy);
  S.pinnedPacket = null;
  S.selected = n ? n.id : null;
  renderInspect();
  staticDirty = true;
});
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const w = toWorld({ x: mx, y: my });
  S.zoom = clamp(S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.12, 3);
  S.panX = mx - w.x * S.zoom;
  S.panY = my - w.y * S.zoom;
  staticDirty = true;
}, { passive: false });

function syncControls() {
  $("#bPause").classList.toggle("on", S.running);
  $("#bPause").textContent = S.running ? "▮▮ PAUSE" : "▶ RESUME";
  $("#ovRight").textContent = S.running ? "FLOW ACTIVE" : "FLOW PAUSED";
}
$("#bPause").onclick = () => { S.running = !S.running; syncControls(); };
$("#bStep").onclick = () => { S.stepBudget = 1; S.running = false; syncControls(); };
$("#bSpeed").onchange = (e) => { S.speed = parseFloat(e.target.value); };
$("#bReset").onclick = () => { S.focusDistrict = null; renderList(); fitView(); };
$("#q").addEventListener("input", (e) => { S.query = e.target.value.trim(); staticDirty = true; });

for (const [id, key] of [["#oDocs","docs"], ["#oTests","tests"], ["#oContract","contract"], ["#oAmbient","ambient"], ["#oLabels","labels"]]) {
  $(id).onchange = (e) => {
    S.opts[key] = e.target.checked;
    relayout(); renderList();
    if (key === "docs" || key === "tests") fitView();
  };
}

function setView(v) {
  S.view = v;
  S.focusDistrict = null; S.selected = null; S.pinnedPacket = null;
  S.activeFlow = "__all__";
  renderViews();
  relayout();
  renderList(); renderInspect(); renderLegend(); renderStats();
  const def = viewById.get(v);
  $("#sideHint").textContent = def?.hint ?? "";
  $("#ovTop").querySelector("b").textContent = def?.title ?? def?.label ?? "";
  fitView();
}

window.addEventListener("resize", () => { resize(); fitView(); });

