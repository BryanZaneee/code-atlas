/* ═══ navigation: one way to go somewhere, and three ways to ask ═══ */

/**
 * `goTo` is the whole of this file's point.
 *
 * Selecting a block used to be `S.selected = id; renderInspect()`, written out
 * at half a dozen call sites, and none of them moved the camera or checked that
 * the block was on screen at all. That is fine when the only way to select is
 * to click something you can already see. It stops being fine the moment a
 * command palette can name a block that is filtered out, collapsed into a
 * megablock, or in a service that is switched off.
 *
 * So this reveals first and selects second: whatever is hiding the target gets
 * turned back on, its district is expanded, and only then does the camera move.
 * Everything that navigates goes through here.
 */
function goTo(id, { focus = true, record = true } = {}) {
  const n = byId.get(id);
  if (!n) return false;
  if (record) navPush(id);
  reveal(n);
  S.selected = id;
  S.pinnedPacket = null;
  if (focus) {
    const drawn = LAYOUT.nodes.find((m) => m.id === id);
    const b = drawn && bboxOf([drawn]);
    if (b && Number.isFinite(b.x0)) fitBox(b, 0.34);
  }
  renderList(); renderInspect(); renderCaption(); renderBreadcrumb();
  return true;
}

/** Turn back on whatever is hiding a node, and expand the district it collapsed into. Relayouts only when something actually changed. */
function reveal(n) {
  let moved = false;
  if (!S.services.has(n.service)) { S.services.add(n.service); moved = true; }
  if (n.vendor && !S.opts.vendor) { S.opts.vendor = true; moved = true; }
  if (n.lang === "md" && !S.opts.docs) { S.opts.docs = true; moved = true; }
  if (n.layer === "test" && !S.opts.tests) { S.opts.tests = true; moved = true; }
  const dk = districtId(n.service, groupKeyOf(n));
  if (S.collapsed.has(dk)) { S.collapsed.delete(dk); moved = true; }
  // A view that isolates a flow draws only that flow, and nothing off it can be reached.
  if (playsFlow(S.view) && S.isolate && !pathSteps().has(n.id)) { S.isolate = false; moved = true; }
  if (moved) { syncControls(); relayout(); renderServices(); }
  return moved;
}

/* ── history ──────────────────────────────────────────────────────────────── */

/** Where you have been, so following an import is not a one-way trip. Capped: this is a trail, not a session log. */
const NAV_MAX = 50;
let navPast = [], navFuture = [];

function navPush(id) {
  if (navPast[navPast.length - 1] === id) return;
  if (S.selected && S.selected !== id) {
    navPast.push(S.selected);
    if (navPast.length > NAV_MAX) navPast.shift();
  }
  navFuture = [];
}

function navBack() {
  const id = navPast.pop();
  if (!id) return false;
  if (S.selected) navFuture.push(S.selected);
  return goTo(id, { record: false });
}

function navForward() {
  const id = navFuture.pop();
  if (!id) return false;
  if (S.selected) navPast.push(S.selected);
  return goTo(id, { record: false });
}

/* ── the breadcrumb ───────────────────────────────────────────────────────── */

/** Service › district › file, above the inspector. It says where you are, which the map stops answering the moment you are zoomed in on one block. */
function renderBreadcrumb() {
  const bar = $("#crumb");
  if (!bar) return;
  const n = S.selected && byId.get(S.selected);
  bar.replaceChildren();
  bar.hidden = !n;
  if (!n) return;

  const crumb = (text, go) => {
    const b = el("button", "crumbBit", text);
    if (go) b.onclick = go;
    else b.disabled = true;
    return b;
  };
  const dk = districtId(n.service, groupKeyOf(n));
  bar.append(
    crumb(svcById.get(n.service)?.label ?? n.service, () => {
      S.selected = null; S.focusDistrict = null;
      renderList(); renderInspect(); renderBreadcrumb(); fitView();
    }),
    el("span", "crumbSep", "›"),
    crumb(labelForKey(groupKeyOf(n)), () => {
      S.selected = null; S.focusDistrict = dk;
      renderList(); renderInspect(); renderBreadcrumb();
      const d = LAYOUT.districts.find((x) => x.id === dk);
      if (d) focusOn(d);
    }),
    el("span", "crumbSep", "›"),
    crumb(n.name),
  );

  const nav = el("span", "crumbNav");
  const arrow = (text, title, on, go) => {
    const b = el("button", "crumbBit", text);
    b.title = title;
    b.disabled = !on;
    b.onclick = go;
    return b;
  };
  nav.append(
    arrow("←", "back to the last block (Alt-←)", navPast.length, navBack),
    arrow("→", "forward (Alt-→)", navFuture.length, navForward),
  );
  bar.append(nav);
}

/* ── moving between blocks by keyboard ────────────────────────────────────── */

/**
 * The nearest drawn block in a screen direction.
 *
 * Screen space, not grid space: the map rotates, so "up" has to mean up on the
 * display rather than −y on a grid the reader cannot see. Candidates are scored
 * by distance with off-axis travel weighted three times, which is what keeps
 * `→` from wandering diagonally when a nearer block sits off to one side.
 */
function nextBlock(from, dx, dy) {
  const here = LAYOUT.nodes.find((n) => n.id === from);
  if (!here?.top) return null;
  let best = null, bestScore = Infinity;
  for (const n of LAYOUT.nodes) {
    if (n.id === from || !n.top) continue;
    const ax = n.top.x - here.top.x, ay = n.top.y - here.top.y;
    const along = ax * dx + ay * dy;
    if (along <= 0) continue;                       // behind us, or square on the axis
    const off = Math.abs(ax * dy - ay * dx);
    if (off > along * 2.5) continue;                // too far off the beam to be "that way"
    const score = along + off * 3;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best?.id ?? null;
}

/** Nothing selected yet, so start somewhere legible rather than nowhere: the nearest block to the middle of the view. */
function firstBlock() {
  let best = null, bestD = Infinity;
  for (const n of LAYOUT.nodes) {
    if (!n.top) continue;
    const s = toScreen(n.top);
    const d = (s.x - W / 2) ** 2 + (s.y - H / 2) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best?.id ?? null;
}

/** Arrow keys move the selection; the same keys step a flow when one is playing, so that keeps priority. */
function navByKey(dx, dy) {
  if (!S.selected) {
    const id = firstBlock();
    return id ? goTo(id) : false;
  }
  const id = nextBlock(S.selected, dx, dy);
  return id ? goTo(id) : false;
}

/* ── the command palette ──────────────────────────────────────────────────── */

/**
 * Everything nameable in one list: files, districts, endpoints, findings.
 *
 * Built fresh each time it opens rather than cached, because the set changes
 * with the view and a stale palette is worse than a slow one. This is name-based
 * only — it never reads a line of source. That is the line the scope guard now
 * draws, and it is drawn here.
 */
function paletteItems() {
  const out = [];
  for (const n of ATLAS.nodes) {
    if (n.kind !== "file") continue;
    out.push({ kind: "file", label: n.name, hint: n.dir === "." ? "" : n.dir, id: n.id, tag: layerById.get(n.layer)?.label ?? n.layer });
  }
  for (const d of LAYOUT.districts) {
    out.push({ kind: "district", label: d.label, hint: svcById.get(d.service)?.label ?? d.service, id: d.id, tag: "DISTRICT" });
  }
  for (const e of ATLAS.endpoints ?? []) {
    out.push({ kind: "endpoint", label: `${e.method} ${e.path}`, hint: e.definedIn ?? "", id: e.definedIn ?? "", tag: "ENDPOINT" });
  }
  for (const f of ATLAS.findings ?? []) {
    out.push({ kind: "finding", label: f.message, hint: f.type, id: f.id, tag: (f.severity ?? "").toUpperCase() });
  }
  return out;
}

/**
 * Subsequence matching, the thing every palette does: `srvmod` finds
 * `service/model.ts`. Scored so that a contiguous run beats a scattered one and
 * a hit at the start of the name beats one in the middle.
 */
function fuzzy(needle, hay) {
  if (!needle) return 0;
  const n = needle.toLowerCase(), h = hay.toLowerCase();
  let score = 0, i = 0, run = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] !== n[i]) { run = 0; continue; }
    run++;
    score += run * 2 + (j === 0 ? 8 : 0);
    i++;
  }
  return i === n.length ? score - h.length * 0.02 : -1;
}

let palItems = [], palShown = [], palAt = 0;

function palOpen() {
  const box = $("#palette");
  if (!box) return;
  palItems = paletteItems();
  box.hidden = false;
  const input = $("#palInput");
  input.value = "";
  palFilter("");
  input.focus?.();
}

function palClose() {
  const box = $("#palette");
  if (!box) return;
  box.hidden = true;
  palShown = [];
}

function palFilter(q) {
  const scored = q
    ? palItems.map((it) => ({ it, s: Math.max(fuzzy(q, it.label), fuzzy(q, it.hint) - 4) })).filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s).map((r) => r.it)
    : palItems.slice(0, 40);
  palShown = scored.slice(0, 40);
  palAt = 0;
  palRender();
}

function palRender() {
  const list = $("#palList");
  if (!list) return;
  list.replaceChildren();
  if (!palShown.length) {
    list.append(el("div", "palEmpty", "nothing by that name"));
    return;
  }
  palShown.forEach((it, i) => {
    const row = el("div", `palRow${i === palAt ? " on" : ""}`);
    row.append(el("span", "palTag", it.tag ?? ""), el("span", "palName", it.label));
    if (it.hint) row.append(el("span", "palHint", it.hint));
    row.onclick = () => palChoose(i);
    list.append(row);
  });
}

function palMove(d) {
  if (!palShown.length) return;
  palAt = (palAt + d + palShown.length) % palShown.length;
  palRender();
}

/** A palette row does whatever that kind of thing does: a file selects, a district focuses, a finding lights its evidence. */
function palChoose(i = palAt) {
  const it = palShown[i];
  if (!it) return;
  palClose();
  if (it.kind === "district") {
    const d = LAYOUT.districts.find((x) => x.id === it.id);
    S.focusDistrict = it.id;
    S.selected = null;
    renderList(); renderInspect(); renderBreadcrumb();
    if (d) focusOn(d);
    return;
  }
  if (it.kind === "finding") {
    selectFinding(it.id);
    return;
  }
  if (it.id) goTo(it.id);
}

function initPalette() {
  const box = $("#palette");
  if (!box) return;
  $("#palInput").addEventListener("input", (e) => palFilter(e.target.value.trim()));
  $("#palInput").addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowDown") palMove(1);
    else if (k === "ArrowUp") palMove(-1);
    else if (k === "Enter") palChoose();
    else if (k === "Escape") palClose();
    else return;
    e.preventDefault();
  });
  box.addEventListener("mousedown", (e) => { if (e.target === box) palClose(); });
}

/** `[` and `]` walk the view strip, wrapping, so the whole strip is reachable without the mouse. */
function cycleView(d) {
  const ids = VIEWS.map((v) => v.id);
  const at = ids.indexOf(S.view);
  const next = ids[((at < 0 ? 0 : at) + d + ids.length) % ids.length];
  if (next) setView(next);
}
