/* ════════════════════ interaction ════════════════════ */
let dragging = false, rotating = false, lastX = 0, lastY = 0, moved = 0;
// Where an alt-drag started, so the cell delta is measured from the grab point
// rather than accumulated per mouse move — accumulating would drift by a cell
// every time the rounding fell either side of a half.
let dragStartX = 0, dragStartY = 0;

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

/** Move the lead runner one hop, in either direction, and stop there. */
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

// Every key here is printed in the hint strip, and the strip is only worth
// having if it is true — so nothing is advertised that is not bound.
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === "q") rotateTo(S.yaw - YAW_STEP);
  else if (k === "e") rotateTo(S.yaw + YAW_STEP);
  // R is "put it back": the camera, and any districts that have been dragged
  // out of the computed layout. One key, one obvious way home.
  else if (k === "r") { const moved = resetDistrictOffsets(); rotateTo(YAW0); fitView(); if (moved) { renderList(); renderInspect(); } }
  else if (k === " ") { S.running = !S.running; syncControls(); }
  else if (k === "arrowright") stepBy(1);
  else if (k === "arrowleft") stepBy(-1);
  else if (k === "escape") {
    // The reader is on top of everything else, so it is what Escape means while
    // it is open. Clearing the selection underneath it would throw away the
    // thing you opened the file to look at.
    if (SRC.open) closeSource();
    else {
      const lit = S.finding;
      S.selected = null; S.pinnedPacket = null; S.focusDistrict = null; S.hover = null;
      S.finding = null; S.request = null;
      // Only when there was one: the evidence set decides what is on the map,
      // so dropping it has to re-pack — and nothing else here does.
      if (lit) relayout();
      renderList(); renderInspect(); renderCaption();
    }
  } else return;
  e.preventDefault();
});

cv.addEventListener("mousedown", (e) => {
  dragging = true; rotating = e.shiftKey; moved = 0;
  lastX = e.clientX; lastY = e.clientY; cv.classList.add("drag");
  // Alt grabs a district, the way shift grabs the camera. A modifier rather
  // than a plain drag because the plates cover most of the map: claiming them
  // for arranging would leave nowhere left to pan from.
  S.dragDistrict = null;
  S.dragCells = { dx: 0, dy: 0 };
  if (e.altKey && !e.shiftKey) {
    const r = cv.getBoundingClientRect();
    const d = pickDistrict(e.clientX - r.left, e.clientY - r.top);
    if (d) { S.dragDistrict = d.id; dragStartX = e.clientX; dragStartY = e.clientY; }
  }
});
window.addEventListener("mouseup", () => {
  if (S.dragDistrict) {
    const { dx, dy } = S.dragCells;
    if (dx || dy) {
      // A refused drop leaves the district where it was. The ghost has already
      // said why in the error colour, so this is the end of it and not a
      // silent no-op.
      if (moveDistrict(S.dragDistrict, { dx, dy })) { renderList(); renderInspect(); }
    }
    S.dragDistrict = null;
    S.dragCells = { dx: 0, dy: 0 };
  }
  dragging = false; rotating = false; cv.classList.remove("drag");
});
window.addEventListener("mousemove", (e) => {
  if (dragging) {
    S.hover = null;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    if (S.dragDistrict) {
      // Screen delta back to ground cells, snapped. Blocks stay on the lattice
      // that way, which is what lets a district be rearranged without the
      // depth sort losing its guarantee that a footprint fits its own cell.
      // Pan and the canvas offset both cancel out of a difference, so only
      // zoom has to be undone before the projection is.
      const g = unproject((e.clientX - dragStartX) / S.zoom, (e.clientY - dragStartY) / S.zoom);
      S.dragCells = { dx: Math.round(g.gx / SPACING), dy: Math.round(g.gy / SPACING) };
    }
    else if (rotating) rotateTo(S.yaw + dx * 0.006);
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
  tip.style.opacity = p || n ? 1 : 0;
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
  // Only a flow view has something to isolate. Disabled rather than hidden, so
  // the strip does not reflow when you change view.
  $("#bIsolate").disabled = !playsFlow(S.view);
  $("#bPause").classList.toggle("on", S.running);
  $("#bPause").textContent = S.running ? "▮▮ PAUSE" : "▶ RESUME";
  const deg = Math.round(S.yaw * 180 / Math.PI) % 360;
  // A derived path says so ON THE CANVAS. PLAN.md is explicit that a caveat
  // living only in a side panel is not a caveat: the thing being watched is the
  // map, so the map is where "this was inferred, not observed" has to appear.
  // A curated flow is a person's assertion, but its hops are still an ordering
  // imports cannot express — build.mjs counts them in meta.derivedCount for
  // exactly that reason. Only tool-derived flows used to raise this badge,
  // which let a curated flow's modelled hops read as observed. Both now say so
  // on the canvas; the wording is what tells them apart.
  const f = flowById.get(S.activeFlow) ?? S.request;
  const modelled = f?.derived || (S.activeFlow === "__all__" && viewById.get(S.view)?.derived);
  // Two elements, not one string: the status half is dropped on a narrow
  // window, the caveat half never is.
  // Live adds the only observed fact on this map, and the badge has to keep it
  // from spreading: a real status came back, and the hops drawn behind it are
  // exactly as modelled as they were a moment ago in MOCK.
  $("#ovWarn").textContent = S.request?.live ? "LIVE · STATUS OBSERVED · PATH STILL MODELLED"
                            : modelled       ? "DERIVED · NOT VERIFIED"
                            : f              ? "CURATED · MODELLED PATH"
                            : "";
  $("#ovStatus").textContent = `${S.running ? "FLOW ACTIVE" : "FLOW PAUSED"} · YAW ${deg}°`;
}
$("#bPause").onclick = () => { S.running = !S.running; syncControls(); };
$("#bStep").onclick = () => { S.stepBudget = 1; S.running = false; syncControls(); };
$("#bSpeed").onchange = (e) => { S.speed = parseFloat(e.target.value); };
$("#bRotL").onclick = () => rotateTo(S.yaw - YAW_STEP);
$("#bRotR").onclick = () => rotateTo(S.yaw + YAW_STEP);
$("#bReset").onclick = () => { S.focusDistrict = null; resetDistrictOffsets(); rotateTo(YAW0); renderList(); fitView(); };
$("#bIsolate").onclick = () => {
  S.isolate = !S.isolate;
  $("#bIsolate").textContent = S.isolate ? "◎ ISOLATED" : "◍ IN CONTEXT";
  $("#bIsolate").classList.toggle("on", S.isolate);
  // Same cost as switching flows, and for the same reason: the node set
  // changes, so the world has to be re-packed and re-rasterised once.
  relayout(); renderList(); fitView();
};
// Shape choices come from the SHAPES table rather than the markup, so adding
// one is a single entry there and never a second list to keep in step.
for (const id of SHAPE_IDS) {
  const o = document.createElement("option");
  o.value = id; o.textContent = SHAPES[id].label.toLowerCase();
  $("#vShape").append(o);
}
$("#vShape").value = S.shape;
$("#vShape").onchange = (e) => { S.shape = e.target.value; reproject(); staticDirty = true; };
// Density options come from the payload's table for the same reason the shapes
// do: the viewer offers what it was given rather than a list of its own.
for (const id of DENSITY_IDS) {
  const o = document.createElement("option");
  o.value = id; o.textContent = id;
  $("#vDensity").append(o);
}
$("#vDensity").value = S.density;
// A density change repacks every district, so the old camera frames the wrong
// world — fit, the way a packing change does.
$("#vDensity").onchange = (e) => { S.density = e.target.value; relayout(); fitView(); };
$("#vPacking").onchange = (e) => { S.packing = e.target.value; relayout(); fitView(); };
$("#vGround").onchange = (e) => { S.ground = e.target.checked; staticDirty = true; };

$("#bColor").onclick = () => {
  S.colorMode = S.colorMode === "mono" ? "identity" : "mono";
  $("#bColor").textContent = S.colorMode === "mono" ? "▣ COLOUR" : "▦ MONO";
  // The sidebar carries identity colour too, on the district codes, so it has
  // to follow the map rather than keep a tint the map just dropped.
  renderList();
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
// Debounced: a query change re-rasterises the whole city, and typing "service"
// character by character asked for seven of them.
let queryTimer = null;
$("#q").addEventListener("input", (e) => {
  const v = e.target.value.trim();
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { S.query = v; staticDirty = true; }, 120);
});

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
  // Cleared before relayout(), because the evidence of a finding is part of
  // what `visibleSet()` keeps.
  S.finding = null;
  // An armed request belongs to the request view; leaving it should not leave
  // a played path animating underneath an unrelated view.
  S.request = null;
  renderViews();
  relayout();
  renderList(); renderInspect(); renderLegend(); renderStats(); renderCaption();
  syncControls();
  const def = viewById.get(v);
  $("#sideHint").textContent = def?.hint ?? "";
  $("#ovTop").querySelector("b").textContent = def?.title ?? def?.label ?? "";
  fitView();
}

window.addEventListener("resize", () => { resize(); fitView(); });

