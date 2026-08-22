/* ═══ palette authorship (U6.3) ═══ */
function keyLabelOf(key) {
  if (S.colorBy === "lang") return key;
  if (S.colorBy === "district") return (LAYOUT.districts.find(d => d.id === key)?.label ?? key).toLowerCase();
  return (layerById.get(key)?.label ?? key).toLowerCase();
}
function renderPaletteSelect() {
  const sel = $("#pPreset");
  if (!sel) return;
  sel.innerHTML = "";
  for (const id of Object.keys(allPalettes())) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = PALETTE_LABEL[id] ?? id;
    sel.append(o);
  }
  sel.value = S.palettePreset;
}
function renderPalette() {
  const w = $("#pLayers");
  if (!w) return;
  w.innerHTML = "";
  const keys = colorKeyList();
  for (const key of keys) {
    const row = el("div", "palRow");
    const inp = el("input");
    inp.type = "color";
    inp.value = colorForKey(key, keys);
    inp.oninput = () => {
      S.keyColors.set(`${S.colorBy}:${key}`, inp.value);
      staticDirty = true;
      renderList(); renderServices(); renderLegend();
    };
    row.append(el("span", null, keyLabelOf(key)), inp);
    w.append(row);
  }
  $("#pMode").value = S.colorBy;
  renderPaletteSelect();
}
function themeConfigSource() {
  const keys = colorKeyList();
  const lines = keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(colorForKey(k, keys))},`);
  return ["// atlas.config.mjs", "theme: {", `  ${S.colorBy === "layer" ? "layers" : S.colorBy === "lang" ? "languages" : "districts"}: {`, ...lines, "  },", "},"].join("\n");
}
function savePaletteAs() {
  const name = prompt("Name this palette");
  if (!name) return;
  const id = name.trim();
  if (!id) return;
  const keys = colorKeyList();
  CUSTOM_PALETTES[id] = keys.map((k) => colorForKey(k, keys));
  saveCustomPalettes();
  S.palettePreset = id;
  S.keyColors.clear();
  staticDirty = true;
  renderPalette(); renderList(); renderServices(); renderLegend();
}

function initInteraction() {
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k === "q") rotateTo(S.yaw - YAW_STEP);
    else if (k === "e") rotateTo(S.yaw + YAW_STEP);
    else if (k === "r") { const movedD = resetOffsets(); rotateTo(YAW0); fitView(); if (movedD) { renderList(); renderInspect(); } }
    else if (k === " ") { S.running = !S.running; syncControls(); }
    else if (k === "arrowright") stepBy(1);
    else if (k === "arrowleft") stepBy(-1);
    else if (k === "escape") {
      if (SRC.open) closeSource();
      else {
        const lit = S.finding;
        S.selected = null; S.pinnedPacket = null; S.focusDistrict = null; S.hover = null;
        S.finding = null; S.request = null;
        if (lit) relayout();
        renderList(); renderInspect(); renderCaption();
      }
    } else return;
    e.preventDefault();
  });
  cv.addEventListener("mousedown", (e) => {
    if (S.introT < 1) S.introT = 1;   /* first input ends the intro; never swallow the event */
    dragging = true; rotating = e.shiftKey; moved = 0;
    camTween = null;
    lastX = e.clientX; lastY = e.clientY; cv.classList.add("drag");
    S.dragDistrict = null; S.dragNode = null;
    S.dragCells = { dx: 0, dy: 0 };
    if ((e.altKey || S.move) && !e.shiftKey) {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const n = pickNode(sx, sy);
      if (n) { S.dragNode = n.id; dragStartX = e.clientX; dragStartY = e.clientY; }
      else {
        const d = pickDistrict(sx, sy);
        if (d) { S.dragDistrict = d.id; dragStartX = e.clientX; dragStartY = e.clientY; }
      }
    }
  });
  window.addEventListener("mouseup", () => {
    if (S.dragNode) {
      const { dx, dy } = S.dragCells;
      if (dx || dy) { if (moveNode(S.dragNode, { dx, dy })) { renderList(); renderInspect(); } }
      S.dragNode = null;
      S.dragCells = { dx: 0, dy: 0 };
    }
    if (S.dragDistrict) {
      const { dx, dy } = S.dragCells;
      if (dx || dy) {
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
      if (S.dragNode || S.dragDistrict) {
        const g = unproject((e.clientX - dragStartX) / S.zoom, (e.clientY - dragStartY) / S.zoom);
        S.dragCells = { dx: Math.round(g.gx / SPACING), dy: Math.round(g.gy / SPACING) };
      }
      else if (rotating) rotateTo(S.yaw + dx * 0.006);
      else { S.panX += dx; S.panY += dy; }
      return;
    }
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      S.hover = null;
      $("#tip").style.opacity = 0;
      return;
    }
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const p = pickPacket(sx, sy);
    const n = p ? null : pickNode(sx, sy);
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
  cv.addEventListener("dblclick", (e) => {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const n = pickNode(sx, sy);
    const d = n ? LAYOUT.districts.find((x) => x.id === n._dk) : pickDistrict(sx, sy);
    if (!d) return;
    e.preventDefault();
    toggleCollapse(d.id);
  });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    camTween = null;
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const w = toWorld({ x: mx, y: my });
    S.zoom = clamp(S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.12, 3);
    S.panX = mx - w.x * S.zoom;
    S.panY = my - w.y * S.zoom;
  }, { passive: false });

  // A hidden panel gives its width back to the canvas, so the drawing surface
  // has to be re-measured once the slide finishes — otherwise the map keeps the
  // old width and stretches. `transitionend` rather than a timer, so the two
  // never drift apart.
  const togglePanel = (btn, cls) => {
    const app = $("#app"), panel = $(cls === "navHidden" ? "#sidebar" : "#inspect");
    app.classList.toggle(cls);
    $(btn).classList.toggle("on", app.classList.contains(cls));
    panel.addEventListener("transitionend", () => { resize(); fitView(); }, { once: true });
  };
  $("#bNav").onclick = () => togglePanel("#bNav", "navHidden");
  $("#bIns").onclick = () => togglePanel("#bIns", "insHidden");
  $("#bPause").onclick = () => { S.running = !S.running; syncControls(); };
  $("#bStep").onclick = () => { S.stepBudget = 1; S.running = false; syncControls(); };
  $("#bSpeed").onchange = (e) => { S.speed = parseFloat(e.target.value); };
  $("#bRotL").onclick = () => rotateTo(S.yaw - YAW_STEP);
  $("#bRotR").onclick = () => rotateTo(S.yaw + YAW_STEP);
  $("#bReset").onclick = () => { S.focusDistrict = null; resetOffsets(); rotateTo(YAW0); renderList(); fitView(); };
  $("#bMove").onclick = () => {
    S.move = !S.move;
    cv.classList.toggle("move", S.move);
    syncControls();
  };
  $("#bIsolate").onclick = () => {
    S.isolate = !S.isolate;
    $("#bIsolate").textContent = S.isolate ? "◎ ISOLATED" : "◍ IN CONTEXT";
    $("#bIsolate").classList.toggle("on", S.isolate);
    relayout(); renderList(); fitView();
  };
  const shapeSel = $("#vShape");
  const vo = document.createElement("option");
  vo.value = "varied"; vo.textContent = "varied by area";
  shapeSel.append(vo);
  for (const id of STYLE_POOL) {
    const o = document.createElement("option");
    o.value = id; o.textContent = SHAPES[id].label.toLowerCase();
    shapeSel.append(o);
  }
  shapeSel.value = S.shape;
  shapeSel.onchange = (e) => { S.shape = e.target.value; reproject(); buildPackets(); staticDirty = true; };
  for (const id of DENSITY_IDS) {
    const o = document.createElement("option");
    o.value = id; o.textContent = id;
    $("#vDensity").append(o);
  }
  $("#vDensity").value = S.density;
  $("#vDensity").onchange = (e) => { S.density = e.target.value; relayout(); fitView(); };
  $("#vPacking").onchange = (e) => { S.packing = e.target.value; relayout(); fitView(); };
  $("#vGroup").value = S.group;
  $("#vGroup").onchange = (e) => {
    S.group = e.target.value;
    S.focusDistrict = null;
    S.shapeByDistrict.clear();
    S.districtOffsets.clear();
    layoutEpoch++;
    relayout(); renderList(); renderServices(); renderInspect(); fitView();
  };
  $("#bHelp").onclick = () => {
    const h = $("#help");
    h.hidden = !h.hidden;
    $("#bHelp").classList.toggle("on", !h.hidden);
  };
  $("#vMaterial").onchange = (e) => { S.material = e.target.value; staticDirty = true; };
  $("#vMaterial").value = S.material;
  $("#vGround").onchange = (e) => { S.ground = e.target.checked; staticDirty = true; };
  $("#vBands").value = S.bands;
  $("#vBands").onchange = (e) => { S.bands = e.target.value; layoutEpoch++; relayout(); fitView(); };
  $("#vRoads").onchange = (e) => { S.roads = e.target.checked; staticDirty = true; };
  $("#vPlinth").onchange = (e) => { S.plinths = e.target.checked; layoutEpoch++; relayout(); fitView(); };
  $("#vFacade").onchange = (e) => { S.facade = e.target.checked; reproject(); staticDirty = true; };
  $("#pMode").onchange = (e) => {
    S.colorBy = e.target.value;
    keyListMemo = { k: null, list: [] };
    staticDirty = true;
    renderPalette(); renderList(); renderServices(); renderLegend();
  };
  $("#pPreset").onchange = (e) => {
    S.palettePreset = e.target.value;
    S.keyColors.clear();
    staticDirty = true;
    renderPalette(); renderList(); renderServices(); renderLegend();
  };
  $("#pSave").onclick = () => savePaletteAs();
  $("#pReset").onclick = () => {
    S.palettePreset = "atlas";
    S.keyColors.clear();
    S.nodeColors.clear();
    staticDirty = true;
    renderPalette(); renderList(); renderServices(); renderLegend(); renderInspect();
  };
  $("#pCopy").onclick = () => {
    const btn = $("#pCopy");
    navigator.clipboard?.writeText(themeConfigSource()).then(
      () => { btn.textContent = "COPIED"; setTimeout(() => { btn.textContent = "COPY CONFIG"; }, 1400); },
      () => { btn.textContent = "CLIPBOARD BLOCKED"; });
  };
  $("#bColor").onclick = () => {
    S.colorMode = S.colorMode === "mono" ? "identity" : "mono";
    $("#bColor").textContent = S.colorMode === "mono" ? "▣ COLOUR" : "▦ MONO";
    renderList(); renderServices();
    staticDirty = true;
  };
  $("#bTheme").onclick = () => setThemeMode(S.theme === "dark" ? "light" : "dark");
  let queryTimer = null;
  $("#q").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => { S.query = v; staticDirty = true; }, 120);
  });
  for (const [id, key] of [["#oDocs", "docs"], ["#oTests", "tests"], ["#oContract", "contract"], ["#oAmbient", "ambient"], ["#oLabels", "labels"], ["#oVendor", "vendor"]]) {
    $(id).onchange = (e) => {
      S.opts[key] = e.target.checked;
      relayout(); renderList(); renderServices();
      if (key === "docs" || key === "tests" || key === "vendor") fitView();
    };
  }
  window.addEventListener("resize", () => { resize(); fitView(true); });
  if (window.ResizeObserver) new ResizeObserver(() => { if (!cv) return; resize(); fitView(true); }).observe($("#stage"));
}
