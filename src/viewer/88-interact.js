/* ═══ interaction ═══ */
let dragging = false, rotating = false, lastX = 0, lastY = 0, moved = 0;
let dragStartX = 0, dragStartY = 0;
function rotateTo(yaw) {
  setYaw(((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
  reproject();
  buildPackets();
  syncControls();
}
function stepBy(d) {
  const r = runners[0];
  if (!r) return;
  r.i = (r.i + d + r.steps.length) % r.steps.length;
  r.t = 0;
  S.running = false;
  selectStep(r.steps[r.i]);
  renderCaption();
  syncControls();
}
function syncControls() {
  $("#bIsolate").disabled = !playsFlow(S.view);
  $("#bPause").classList.toggle("on", S.running);
  $("#bPause").textContent = S.running ? "▮▮ PAUSE" : "▶ RESUME";
  const deg = Math.round(S.yaw * 180 / Math.PI) % 360;
  // A modelled path says so on the canvas, curated or derived: a caveat living only in a side panel is not a caveat.
  // No view guard on the curated arm — a curated path armed in the composer is
  // still modelled, and gating this on isFlowView() silently dropped its caveat.
  const f = flowById.get(S.activeFlow) ?? S.request;
  const modelled = f?.derived || (S.activeFlow === "__all__" && viewById.get(S.view)?.derived);
  // Two elements, so the status half can drop on a narrow window while the caveat never does.
  $("#ovWarn").textContent = S.request?.live ? "LIVE · STATUS OBSERVED · PATH STILL MODELLED"
    : modelled ? "DERIVED · NOT VERIFIED"
    : f ? "CURATED · MODELLED PATH" : "";
  $("#ovStatus").textContent = `${S.running ? "FLOW ACTIVE" : "FLOW PAUSED"} · YAW ${deg}°`;
  $("#bMove").classList.toggle("on", S.move);
  cv?.classList.toggle("move", S.move);
}
function setView(v) {
  S.view = v;
  S.focusDistrict = null; S.selected = null; S.pinnedPacket = null;
  S.activeFlow = "__all__";
  S.finding = null;
  S.request = null;
  viewFade = REDUCED_MOTION ? 0 : 1;
  renderViews();
  relayout();
  renderList(); renderInspect(); renderLegend(); renderStats(); renderCaption();
  syncControls();
  const def = viewById.get(v);
  $("#helpHint").textContent = def?.hint ?? "";
  $("#helpTitle").textContent = `READING ${(def?.label ?? "THIS VIEW").toUpperCase()}`;
  $("#ovTitle").textContent = def?.title ?? def?.label ?? "";
  fitView();
}
function setThemeMode(mode) {
  S.theme = mode === "dark" ? "dark" : "light";
  applyTheme(S.theme);
  document.documentElement.setAttribute("data-theme", S.theme);
  $("#bTheme").textContent = S.theme === "dark" ? "◑ LIGHT" : "◐ DARK";
  renderLegend();
  staticDirty = true;
}
