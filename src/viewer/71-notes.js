/* ═══ per-block appearance + notes ═══ */
function renderAppearance(b, n) {
  b.append(el("h3", null, "APPEARANCE"));
  const colRow = el("div", "palRow");
  const col = el("input");
  col.type = "color";
  col.value = S.nodeColors.get(n.id) ?? colorOf(n);
  col.oninput = () => { S.nodeColors.set(n.id, col.value); staticDirty = true; };
  colRow.append(el("span", null, "colour"), col);
  b.append(colRow);

  const shRow = el("label", "pick");
  const sh = el("select");
  for (const [v, label] of [["auto", "auto"], ...SHAPE_IDS.map((id) => [id, SHAPES[id].label.toLowerCase()])]) {
    const o = document.createElement("option");
    o.value = v; o.textContent = label;
    sh.append(o);
  }
  sh.value = S.nodeShapes.get(n.id) ?? "auto";
  sh.onchange = () => {
    if (sh.value === "auto") S.nodeShapes.delete(n.id);
    else S.nodeShapes.set(n.id, sh.value);
    reproject(); buildPackets(); staticDirty = true;
  };
  shRow.append(el("span", null, "shape"), sh);
  b.append(shRow);

  const szRow = el("div", "rangeRow");
  const sz = el("input");
  sz.type = "range"; sz.min = "0.5"; sz.max = "1.6"; sz.step = "0.05";
  sz.value = String(S.nodeSizes.get(n.id) ?? 1);
  const szVal = el("span", null, `${Math.round(parseFloat(sz.value) * 100)}%`);
  sz.oninput = () => {
    const v = parseFloat(sz.value);
    szVal.textContent = `${Math.round(v * 100)}%`;
    if (Math.abs(v - 1) < 0.001) S.nodeSizes.delete(n.id);
    else S.nodeSizes.set(n.id, v);
    reproject(); staticDirty = true;
  };
  szRow.append(el("span", null, "size"), sz, szVal);
  b.append(szRow);
  b.append(el("div", "hint", `Footprint and height both come from ${fmt(n.loc ?? 0)} lines — this scales that block's footprint on top.`));

  if (S.nodeColors.has(n.id) || S.nodeShapes.has(n.id) || S.nodeSizes.has(n.id)) {
    const rst = el("button", null, "↺ RESET THIS BLOCK");
    rst.style.marginTop = "7px";
    rst.onclick = () => {
      S.nodeColors.delete(n.id); S.nodeShapes.delete(n.id); S.nodeSizes.delete(n.id);
      reproject(); buildPackets(); staticDirty = true; renderInspect();
    };
    b.append(rst);
  }
  const note = S.notes.get(n.id);
  if (note) {
    b.append(el("h3", null, "NOTE"));
    const nn = el("div", "note", note);
    b.append(nn);
  }
}
const NOTES_KEY = `codeAtlas:notes:${ATLAS.meta.repo}`;
function loadNotes() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}");
    for (const [k, v] of Object.entries(raw ?? {})) S.notes.set(k, v);
  } catch { /* a hardened browser, or notes written by an older payload; start empty */ }
}
let noteTimer = null;
function saveNotes() {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(Object.fromEntries(S.notes))); } catch { /* a hardened browser; notes still work for this page's life */ }
  }, 250);
}
function renderNotes(b) {
  const n = byId.get(S.selected);
  if (!n) {
    b.append(el("div", "hint", "Pick a block on the map or a file in a district, and this tab keeps your note about it. Notes live in this browser — they are yours, not the scan's."));
    const withNotes = [...S.notes.entries()].filter(([, v]) => v.trim());
    if (withNotes.length) {
      b.append(el("h3", null, `NOTED FILES (${withNotes.length})`));
      for (const [id, text] of withNotes) {
        const r = el("div", "row mini");
        r.append(el("span", "nm", byId.get(id)?.name ?? id), el("span", "sub", text.trim().slice(0, 22)));
        r.onclick = () => { S.selected = id; renderInspect(); };
        b.append(r);
      }
    }
    return;
  }
  b.append(el("div", "eyebrow", "NOTE"));
  b.append(el("div", "title", n.name));
  b.append(el("div", "path", n.id));
  const ta = el("textarea");
  ta.id = "noteBox";
  ta.rows = 10;
  ta.placeholder = "What should the next person know about this file?";
  ta.value = S.notes.get(n.id) ?? "";
  ta.style.marginTop = "7px";
  ta.oninput = () => {
    if (ta.value.trim()) S.notes.set(n.id, ta.value);
    else S.notes.delete(n.id);
    saveNotes();
  };
  b.append(ta);
  b.append(el("div", "hint", "Saved as you type, in this browser only."));
}
