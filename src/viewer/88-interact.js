/* ════════════════════ interaction ════════════════════ */
let dragging = false, rotating = false, lastX = 0, lastY = 0, moved = 0;

/**
 * Rotating re-projects; it does not re-lay-out. Nothing moves in world space,
 * so districts, plates and packet routes all survive a turn unchanged.
 */
function rotateTo(yaw) {
  setYaw(((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
  reproject();
  buildPackets();
  syncControls();
}

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === "q") rotateTo(S.yaw - YAW_STEP);
  else if (k === "e") rotateTo(S.yaw + YAW_STEP);
  else if (k === "r") { rotateTo(YAW0); fitView(); }
  else return;
  e.preventDefault();
});

cv.addEventListener("mousedown", (e) => {
  dragging = true; rotating = e.shiftKey; moved = 0;
  lastX = e.clientX; lastY = e.clientY; cv.classList.add("drag");
});
window.addEventListener("mouseup", () => { dragging = false; rotating = false; cv.classList.remove("drag"); });
window.addEventListener("mousemove", (e) => {
  if (dragging) {
    S.hover = null;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    if (rotating) rotateTo(S.yaw + dx * 0.006);
    else { S.panX += dx; S.panY += dy; }   // pan is a blit offset, not a re-render
    return;
  }
  const r = cv.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
    S.hover = null;
    $("#tip").style.opacity = 0;
    return;
  }
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const p = pickPacket(sx, sy);
  const n = p ? null : pickNode(sx, sy);
  // Free now that the overlay is a live pass: this used to cost a full
  // re-rasterisation of the city per mouse move, so there was no hover state.
  S.hover = n ? n.id : null;
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
    else { S.pinnedPacket = null; S.selected = p.data.to; renderInspect(); }
    return;
  }
  const n = pickNode(sx, sy);
  S.pinnedPacket = null;
  S.selected = n ? n.id : null;
  renderInspect();
});
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const w = toWorld({ x: mx, y: my });
  S.zoom = clamp(S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.12, 3);
  S.panX = mx - w.x * S.zoom;
  S.panY = my - w.y * S.zoom;
  // No invalidation: the cache re-renders only when zoom crosses a mip bucket.
}, { passive: false });

function syncControls() {
  $("#bPause").classList.toggle("on", S.running);
  $("#bPause").textContent = S.running ? "▮▮ PAUSE" : "▶ RESUME";
  const deg = Math.round(S.yaw * 180 / Math.PI) % 360;
  $("#ovRight").textContent = `${S.running ? "FLOW ACTIVE" : "FLOW PAUSED"} · YAW ${deg}°`;
}
$("#bPause").onclick = () => { S.running = !S.running; syncControls(); };
$("#bStep").onclick = () => { S.stepBudget = 1; S.running = false; syncControls(); };
$("#bSpeed").onchange = (e) => { S.speed = parseFloat(e.target.value); };
$("#bRotL").onclick = () => rotateTo(S.yaw - YAW_STEP);
$("#bRotR").onclick = () => rotateTo(S.yaw + YAW_STEP);
$("#bReset").onclick = () => { S.focusDistrict = null; rotateTo(YAW0); renderList(); fitView(); };
$("#bColor").onclick = () => {
  S.colorMode = S.colorMode === "mono" ? "identity" : "mono";
  $("#bColor").textContent = S.colorMode === "mono" ? "▣ COLOUR" : "▦ MONO";
  staticDirty = true;
};
$("#bTheme").onclick = () => {
  S.theme = S.theme === "dark" ? "light" : "dark";
  applyTheme(S.theme);
  document.documentElement.setAttribute("data-theme", S.theme);
  $("#bTheme").textContent = S.theme === "dark" ? "◑ LIGHT" : "◐ DARK";
  renderLegend();
  staticDirty = true;
};
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

