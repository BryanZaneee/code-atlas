/* ════════════════════ source panel ════════════════════
 *
 * The other half of INSPECT: INFO says what the tool concluded about a file,
 * SOURCE shows the file. It is a wide right-docked overlay rather than a third
 * column because 310px is unreadable for code — the map keeps rendering behind
 * it, so reading a line never costs you the place you were reading it from.
 *
 * Two constraints shape everything below.
 *
 * ONE: repository source is never markup. Every character that arrives from
 * `/api/source` reaches the document as a text node — `document.createTextNode`
 * or `.textContent`, never `innerHTML`. Prism is used as a tokenizer only; the
 * token tree is walked here and the DOM is built by hand. A file containing
 * `<script>` is a file, not a script, and the server's `text/plain` is only the
 * first of the two places that has to hold.
 *
 * TWO: this is the viewer's only network path, and it must fail out loud. A
 * refused or unreachable read paints the reason, because a blank panel is the
 * prototype's documented worst failure and "nothing happened" is the least
 * informative thing a tool can say.
 */

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

/**
 * Is there a server to ask? `build` produces one HTML file that is opened from
 * disk (`file:`), and `serve` sends the same bytes over loopback — same markup,
 * two worlds. The protocol is the honest test: no probe, no timeout, no feature
 * offered that cannot work.
 */
function srcServed() {
  return location.protocol === "http:" || location.protocol === "https:";
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

/**
 * Prism's token tree -> a flat list of `[text, className]`.
 *
 * Flat because the gutter needs lines, and a token may straddle several of them
 * (a block comment, a template literal). Splitting a nested tree on newlines is
 * the part that goes wrong; splitting a flat list is arithmetic.
 */
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
    // A grammar that throws is a cosmetic failure. Losing the colour is fine;
    // losing the file because of it is not.
    return [[text, ""]];
  }
}

/**
 * Paint `text` into `host` as numbered lines, `hit` highlighted and centred.
 *
 * Takes its container as an argument and touches no other state, which is what
 * lets the escaping guarantee be tested directly rather than inferred.
 */
function srcPaint(host, text, lang, hit) {
  const code = el("div", "srcCode");
  const pieces = srcPieces(text, lang);
  const total = text.split("\n").length;
  const pad = String(total).length;

  let row = null, cell = null, ln = 0;
  const newRow = () => {
    ln++;
    row = el("div", "ln" + (ln === hit ? " hit" : ""));
    row.append(el("span", "g", String(ln).padStart(pad, " ")));
    cell = el("span", "c");
    row.append(cell);
    code.append(row);
  };
  newRow();

  for (const [chunk, cls] of pieces) {
    const parts = chunk.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) newRow();
      if (!parts[i]) continue;
      // The one line that matters: source becomes a text node, always. A span
      // when it is coloured, a bare text node when it is not — neither is parsed.
      if (cls) cell.append(el("span", cls, parts[i]));
      else cell.append(document.createTextNode(parts[i]));
    }
  }

  host.replaceChildren(code);
  const target = hit > 0 && hit <= ln ? code.children[hit - 1] : null;
  if (target) {
    // Centred, not merely visible: a line pinned to the top edge has no context
    // above it, which is half of what reading a line is for.
    code.scrollTop = Math.max(0, target.offsetTop - code.clientHeight / 2 + target.offsetHeight / 2);
  }
  return ln;
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

/**
 * Open a file at a line. The single entry point — every jump-to-line in the
 * INFO panel is a call to this, so there is one fetch path and one failure path.
 */
function openSource(path, line) {
  SRC.open = true;
  SRC.path = path;
  SRC.line = line || 0;
  $("#source").hidden = false;
  // The map keeps animating behind the reader, so its overlays step aside
  // rather than hide — see `#main.reading` in style.css.
  $("#main").classList.add("reading");
  srcSyncTabs();
  $("#srcPath").textContent = path ?? "—";
  $("#srcWhere").textContent = line ? `line ${fmt(line)}` : "";

  if (!srcServed()) {
    // Not an error. This atlas is a file on disk, and saying so beats a fetch
    // that fails for a reason the reader would have to guess at.
    srcMessage(SRC_STATIC_COPY, "This atlas was built as a single file, so it carries the map but not the code it maps. Served from `atlas serve`, this panel reads the file straight from the repository.");
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
    const lines = srcPaint($("#srcBody"), text, srcLangOf(path), SRC.line);
    $("#srcWhere").textContent = SRC.line ? `line ${fmt(SRC.line)} of ${fmt(lines)}` : `${fmt(lines)} lines`;
  }).catch((err) => {
    if (gen !== SRC.gen) return;
    srcMessage(err.title ?? "Could not read this file.", err.detail ?? String(err.message ?? err), true);
  });
}

/**
 * Fetch through the server's allowlisted reader.
 *
 * `path` is the node id, which IS the repository-relative path — the same string
 * the scan put in the allowlist, which is why this needs no path handling of its
 * own. A refusal is a bare 404 by design; the explanation is written here,
 * because the server deliberately tells an attacker nothing.
 */
async function srcRead(path) {
  const hit = SRC.cache.get(path);
  if (hit != null) return hit;

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
  $("#tabInfo").classList.toggle("on", !SRC.open);
  $("#tabSource").classList.toggle("on", SRC.open);
}

/**
 * What SOURCE opens for the current selection, when it is opened from the tab
 * rather than from a specific line.
 */
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

/**
 * The import that justifies a derived hop, if one exists.
 *
 * A hop the tool inferred across a gap has no import to show, and no line is
 * invented for it — that is the honesty contract in the one place it is easiest
 * to break, because a jump-to-line that lands anywhere at all feels like proof.
 */
function srcHopImport(st) {
  if (!st) return null;
  const e = (edgesFrom.get(st.from) ?? []).find((x) => x.to === st.to && x.line);
  return e ? { path: e.from, line: e.line } : null;
}

/**
 * A jump-to-line control, or null when there is no server to read from.
 *
 * Null rather than a disabled button: an affordance that cannot work is worse
 * than no affordance, and the SOURCE tab already carries the explanation.
 */
function srcJump(label, path, line) {
  if (!srcServed() || !path) return null;
  // A null label is the in-row form: inside a list of imports the file is
  // already named by the row, so the chip only has to say which line.
  const text = label === null ? `L${line}` : `${label} ${path.split("/").pop()}${line ? `:${line}` : ""}`;
  const b = el("button", "srcJump", text);
  b.title = `${path}${line ? `:${line}` : ""}`;
  b.onclick = (ev) => { ev.stopPropagation(); openSource(path, line); };
  return b;
}

function srcInit() {
  const served = srcServed();
  const tab = $("#tabSource");
  if (!served) {
    tab.classList.add("off");
    tab.title = SRC_STATIC_COPY;
  }
  tab.onclick = () => { const s = srcSubject(); openSource(s.path, s.line); };
  $("#tabInfo").onclick = () => closeSource();
  $("#srcClose").onclick = () => closeSource();

  // Resize by dragging the left edge. Bounded on both sides: narrower than this
  // is not worth opening, wider leaves nothing of the map to read it against.
  const grip = $("#srcGrip");
  let sizing = false;
  grip.addEventListener("mousedown", (e) => { sizing = true; e.preventDefault(); });
  window.addEventListener("mousemove", (e) => {
    if (!sizing) return;
    // A mouseup the window never saw — released outside it, or swallowed by
    // another handler — would otherwise leave every later mouse move resizing
    // the panel. `buttons` is the state, not the event, so it recovers.
    if (!e.buttons) { sizing = false; return; }
    const w = clamp(window.innerWidth - e.clientX, 360, Math.round(window.innerWidth * 0.92));
    $("#main").style.setProperty("--src-w", `${w}px`);
  });
  window.addEventListener("mouseup", () => { sizing = false; });
}
