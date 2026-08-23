/* Source panel. Two constraints: repository source reaches the DOM only as text nodes (Prism tokenizes, the DOM is built by hand, never innerHTML), and every failed read paints its reason rather than leaving a blank panel. */

const SRC = {
  open: false,
  path: null,
  line: 0,
  gen: 0,                 // request generation — a slow fetch must never paint over a newer one
  cache: new Map(),       // path -> text, so re-opening a file is free
};

/** Highlighting a very large file costs more than it returns; the text still renders. */
const SRC_HIGHLIGHT_LIMIT = 400_000;

/** Verbatim from PLAN.md: what a built, server-less atlas says instead of source. */
const SRC_STATIC_COPY = "Source is not embedded. Run `atlas serve`, or rebuild with --embed-source.";

/** Is there a server to ask? The protocol is the honest test: no probe, no timeout, no feature offered that cannot work. */
function srcServed() {
  return location.protocol === "http:" || location.protocol === "https:";
}

/** Can this page read source at all, live or embedded? Every jump-to-line affordance gates on this, not on srcServed() alone. */
function srcCapable() {
  return srcServed() || !!ATLAS.source;
}

let srcEmbeddedIndex = null; // ATLAS.source.paths, memoized as a Set for O(1) membership

/** `true` when this exact path was embedded — not just that embedding ran. */
function srcEmbeddedHas(path) {
  if (!ATLAS.source) return false;
  if (!srcEmbeddedIndex) srcEmbeddedIndex = new Set(ATLAS.source.paths);
  return srcEmbeddedIndex.has(path);
}

let srcEmbeddedFilesPromise = null; // memoized: the one blob is inflated at most once

/** Embedded files, inflating `ATLAS.source.blob` once and caching it: the gzip stream covers every file together, so it cannot be inflated per file. */
function srcEmbeddedFiles() {
  if (!ATLAS.source.gzip) return Promise.resolve(ATLAS.source.files);
  if (!srcEmbeddedFilesPromise) {
    srcEmbeddedFilesPromise = (async () => {
      const bin = atob(ATLAS.source.blob);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    })();
  }
  return srcEmbeddedFilesPromise;
}

/** Decode one embedded file's text out of `srcEmbeddedFiles()`'s map. */
async function srcEmbeddedText(path) {
  return (await srcEmbeddedFiles())[path];
}

/** The footer's honesty statement about this exact page: three states, because embedded source means the file carries the codebase, not just the map. */
function srcBadgeText() {
  if (ATLAS.source) {
    const n = ATLAS.source.paths.length;
    return `SOURCE EMBEDDED${ATLAS.source.gzip ? " (GZIP)" : ""} · ${fmt(n)} FILE${n === 1 ? "" : "S"} IN THIS HTML`;
  }
  return srcServed()
    ? "READ-ONLY PROJECTION · SOURCE SERVED LIVE"
    : "READ-ONLY PROJECTION · NO SOURCE EMBEDDED";
}

/** Prism grammar for a path, or null — an unknown extension renders as plain text. */
function srcLangOf(path) {
  const ext = (path.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
  return {
    ts: "typescript", mts: "typescript", cts: "typescript",
    tsx: "tsx", jsx: "jsx",
    js: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", pyi: "python",
    sql: "sql", json: "json",
  }[ext] ?? null;
}

/** Prism's token tree flattened to `[text, className]`: a token may straddle lines, and splitting a flat list on newlines is arithmetic. */
function srcFlatten(tokens, cls, out) {
  for (const t of tokens) {
    if (typeof t === "string") { out.push([t, cls]); continue; }
    const kind = String(t.type ?? "").replace(/[^a-z0-9-]/gi, "");
    const own = kind ? `t-${kind}` : cls;
    if (typeof t.content === "string") out.push([t.content, own]);
    else srcFlatten(Array.isArray(t.content) ? t.content : [t.content], own, out);
  }
}

/** `[text, className]` pieces for a file, tokenized if we have a grammar for it. */
function srcPieces(text, lang) {
  const grammar = lang && window.Prism?.languages?.[lang];
  if (!grammar || text.length > SRC_HIGHLIGHT_LIMIT) return [[text, ""]];
  try {
    const out = [];
    srcFlatten(Prism.tokenize(text, grammar), "", out);
    return out;
  } catch {
    // A grammar that throws is cosmetic: lose the colour, never the file.
    return [[text, ""]];
  }
}

/** Paint `text` into `host` as numbered lines; takes its container and touches no other state, so the escaping guarantee is directly testable. */
function srcPaint(host, text, lang, hit, jumps = null) {
  const code = el("div", "srcCode");
  const pieces = srcPieces(text, lang);
  const total = text.split("\n").length;
  const pad = String(total).length;

  let row = null, cell = null, ln = 0;
  const newRow = () => {
    ln++;
    const to = jumps?.get(ln);
    row = el("div", "ln" + (ln === hit ? " hit" : "") + (to ? " goes" : ""));
    row.append(el("span", "g", String(ln).padStart(pad, " ")));
    cell = el("span", "c");
    row.append(cell);
    if (to) {
      // Go-to-definition, from an edge the scanner already resolved rather than
      // from re-reading the line: the arrow appears only where resolution
      // actually succeeded, so it never offers a jump that goes nowhere.
      const go = el("button", "srcGo", "→");
      go.title = `go to ${byId.get(to)?.name ?? to}`;
      go.onclick = (ev) => { ev.stopPropagation(); closeSource(); goTo(to); };
      row.append(go);
    }
    code.append(row);
  };
  newRow();

  for (const [chunk, cls] of pieces) {
    const parts = chunk.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) newRow();
      if (!parts[i]) continue;
      // The line that matters: source becomes a text node, always, coloured or not, and neither form is parsed.
      if (cls) cell.append(el("span", cls, parts[i]));
      else cell.append(document.createTextNode(parts[i]));
    }
  }

  host.replaceChildren(code);
  const target = hit > 0 && hit <= ln ? code.children[hit - 1] : null;
  if (target) {
    // Centred, not merely visible: a line at the top edge has no context above it.
    code.scrollTop = Math.max(0, target.offsetTop - code.clientHeight / 2 + target.offsetHeight / 2);
  }
  return ln;
}

/** Which lines of a file carry a resolved internal import, and where each one goes. Read off the edge list, so a line only offers a jump when the scanner actually landed it. */
function srcJumpLines(path) {
  const out = new Map();
  for (const e of edgesFrom.get(path) ?? []) {
    if (!e.line || e.kind.startsWith("test:")) continue;
    if (!byId.has(e.to)) continue;
    if (!out.has(e.line)) out.set(e.line, e.to);
  }
  return out.size ? out : null;
}

/** A message in the panel body — the failure path, and it must never be empty. */
function srcMessage(title, body, warn) {
  const wrap = el("div", "srcMsg");
  wrap.append(el("div", "srcMsgTitle" + (warn ? " warn" : ""), title));
  if (body) wrap.append(el("div", "hint", body));
  $("#srcBody").replaceChildren(wrap);
}

/** The endpoint record behind an endpoint node id, for its declared line. */
let srcEpMap = null;
function srcEndpoint(id) {
  if (!srcEpMap) srcEpMap = new Map((ATLAS.endpoints ?? []).map((e) => [e.id, e]));
  return srcEpMap.get(id);
}

/** Open a file at a line: the single entry point, so there is one fetch path and one failure path. */
function openSource(path, line) {
  SRC.open = true;
  SRC.path = path;
  SRC.line = line || 0;
  $("#source").hidden = false;
  // The map keeps animating behind the reader, so overlays step aside rather than hide; see `#main.reading` in style.css.
  $("#main").classList.add("reading");
  srcSyncTabs();
  $("#srcPath").textContent = path ?? "—";
  $("#srcWhere").textContent = line ? `line ${fmt(line)}` : "";

  if (!srcCapable()) {
    // Not an error: this atlas is a file on disk, and saying so beats a fetch failing for a guessable reason.
    srcMessage(SRC_STATIC_COPY, "This atlas was built as a single file, so it carries the map but not the code it maps. Served from `atlas serve`, this panel reads the file straight from the repository; rebuilt with --embed-source, it reads what was baked in instead.");
    return;
  }
  if (!path) {
    srcMessage("Nothing selected.", "Choose a file in the map, or follow a route, an import or a hop from the INFO tab — each one opens at the line it names.");
    return;
  }

  const gen = ++SRC.gen;
  srcMessage(`Reading ${path}…`, null);
  srcRead(path).then((text) => {
    if (gen !== SRC.gen) return;      // a newer request won; this one's paint is stale
    const lines = srcPaint($("#srcBody"), text, srcLangOf(path), SRC.line, srcJumpLines(path));
    $("#srcWhere").textContent = SRC.line ? `line ${fmt(SRC.line)} of ${fmt(lines)}` : `${fmt(lines)} lines`;
  }).catch((err) => {
    if (gen !== SRC.gen) return;
    srcMessage(err.title ?? "Could not read this file.", err.detail ?? String(err.message ?? err), true);
  });
}

/** Read a file: cache, then embedded (which beats a live fetch because protocol alone can look served with no `/api/source` behind it), then the server for paths the embed glob left out. */
async function srcRead(path) {
  const hit = SRC.cache.get(path);
  if (hit != null) return hit;

  if (srcEmbeddedHas(path)) {
    const text = await srcEmbeddedText(path);
    SRC.cache.set(path, text);
    return text;
  }

  if (!srcServed()) {
    // Embedding ran but this file was outside the glob and there is no server: say exactly that, or it reads as a bug.
    throw Object.assign(new Error("not embedded"), {
      title: "This file was not embedded.",
      detail: ATLAS.source?.glob
        ? `Built with --embed-source "${ATLAS.source.glob}", which did not match ${path}. Run \`atlas serve\` to read it live, or rebuild without a glob to embed everything.`
        : `${path} was not part of the scanned set this atlas embedded. Run \`atlas serve\` to read it live.`,
    });
  }

  let res;
  try {
    res = await fetch(`/api/source?path=${encodeURIComponent(path)}`, { headers: { accept: "text/plain" } });
  } catch (e) {
    throw Object.assign(new Error(e.message), {
      title: "The atlas server did not answer.",
      detail: "This panel reads source over loopback from the `atlas serve` process that produced the page. If that process has stopped, the map still works — it is already in the page — but the code behind it is no longer readable.",
    });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), {
      title: `The server would not serve this file (${res.status}).`,
      detail: "`atlas serve` hands back only the exact set of files this scan kept, and nothing else — no traversal, no symlinks, no files outside the map. A path the scan excluded is refused here too.",
    });
  }
  const text = await res.text();
  SRC.cache.set(path, text);
  return text;
}

function closeSource() {
  SRC.open = false;
  $("#source").hidden = true;
  $("#main").classList.remove("reading");
  srcSyncTabs();
}

function srcSyncTabs() {
  // Three tabs now, not two: INFO and NOTES share the "reader is not in SOURCE"
  // state, so which of them is lit comes from S.insTab rather than from SRC.
  $("#tabInfo").classList.toggle("on", !SRC.open && S.insTab === "info");
  $("#tabNotes").classList.toggle("on", !SRC.open && S.insTab === "notes");
  $("#tabSource").classList.toggle("on", SRC.open);
}

/** What SOURCE opens for the current selection when opened from the tab rather than a specific line. */
function srcSubject() {
  const st = S.pinnedPacket;
  if (st) {
    const jump = srcHopImport(st);
    if (jump) return jump;
    const from = byId.get(st.from);
    if (from?.kind === "file") return { path: from.id, line: 0 };
  }
  const n = byId.get(S.selected);
  if (!n) return { path: null, line: 0 };
  if (n.kind === "endpoint") {
    const ep = srcEndpoint(n.id);
    if (ep) return { path: ep.definedIn, line: ep.line };
  }
  if (n.kind === "file") return { path: n.id, line: 0 };
  return { path: null, line: 0 };
}

/** The import justifying a derived hop, if one exists; an inferred hop gets no invented line, because a jump that lands anywhere feels like proof. */
function srcHopImport(st) {
  if (!st) return null;
  const e = (edgesFrom.get(st.from) ?? []).find((x) => x.to === st.to && x.line);
  return e ? { path: e.from, line: e.line } : null;
}

/** A jump-to-line control, or null when nothing can be read: an affordance that cannot work is worse than none. */
function srcJump(label, path, line) {
  if (!srcCapable() || !path) return null;
  // A null label is the in-row form, where the row already names the file and the chip only says which line.
  const text = label === null ? `L${line}` : `${label} ${path.split("/").pop()}${line ? `:${line}` : ""}`;
  const b = el("button", "srcJump", text);
  b.title = `${path}${line ? `:${line}` : ""}`;
  b.onclick = (ev) => { ev.stopPropagation(); openSource(path, line); };
  return b;
}

function srcInit() {
  const tab = $("#tabSource");
  if (!srcCapable()) {
    tab.classList.add("off");
    tab.title = SRC_STATIC_COPY;
  }
  tab.onclick = () => { const s = srcSubject(); openSource(s.path, s.line); };
  $("#tabInfo").onclick = () => { S.insTab = "info"; closeSource(); renderInspect(); srcSyncTabs(); };
  $("#tabNotes").onclick = () => { S.insTab = "notes"; closeSource(); renderInspect(); srcSyncTabs(); };
  $("#srcClose").onclick = () => closeSource();

  // Drag the left edge to resize, bounded both ways so the panel stays readable and the map stays visible.
  const grip = $("#srcGrip");
  let sizing = false;
  grip.addEventListener("mousedown", (e) => { sizing = true; e.preventDefault(); });
  window.addEventListener("mousemove", (e) => {
    if (!sizing) return;
    // `buttons` is state, not the event, so a mouseup the window never saw cannot leave every later move resizing.
    if (!e.buttons) { sizing = false; return; }
    const w = clamp(window.innerWidth - e.clientX, 360, Math.round(window.innerWidth * 0.92));
    $("#main").style.setProperty("--src-w", `${w}px`);
  });
  window.addEventListener("mouseup", () => { sizing = false; });
}
