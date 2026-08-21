/* ════════════════════ live mode ════════════════════
 *
 * The only observed facts on this map: a status code and an end-to-end
 * duration. The path they sit next to is still modelled, and #ovWarn says so.
 *
 * A non-2xx halts at hop 1 rather than animating a journey that did not finish.
 * NO PER-HOP TIMINGS, EVER: `ms / steps.length` reads reasonably in a diff and
 * is a fabrication, since no internal hop is ever watched. test/live-view.test.mjs
 * asserts no step object grows a timing field, to make writing that line fail.
 * The proxy returns no response body, so there is none to render.
 */

/** What the server told the page about live mode, or nothing on a built file. */
const LIVE = {
  info: ATLAS.live ?? null,
  /** endpoint id -> [ms, …] for this session only. Never persisted; see below. */
  samples: new Map(),
  /** The last observed response, per endpoint id. */
  last: new Map(),
  /** Sends whose timing was not a round trip, and so were not counted. */
  dropped: new Map(),
  busy: false,
};

const LIVE_AUTH_KEY = `atlas:live-auth:${ATLAS.meta.repo}`;

/** srcServed(), not srcCapable(): an embedded file carries source but has no server to proxy through. */
function liveOffered() {
  return srcServed() && !!LIVE.info?.offered;
}

/** Why LIVE cannot be offered, in words the reader can act on. */
function liveReason() {
  if (!srcServed()) {
    return "This atlas is a file on disk. Live mode needs the server, so run it through `atlas serve`.";
  }
  return LIVE.info?.reason || "The server was not started with --allow-live.";
}

/** The token the page holds, when the server is not injecting one. */
function liveToken() {
  if (LIVE.info?.auth === "env") return null;      // the server has it; the page must not
  try { return sessionStorage.getItem(LIVE_AUTH_KEY) || ""; } catch { return ""; }
}

/** sessionStorage, never localStorage, and never alongside the composer's persisted fields. */
function liveSetToken(v) {
  try {
    if (v) sessionStorage.setItem(LIVE_AUTH_KEY, v);
    else sessionStorage.removeItem(LIVE_AUTH_KEY);
  } catch { /* a hardened browser; the field still works for this page's life */ }
}

/** The status class a ring colour comes from. */
function liveClassOf(status) {
  if (status == null) return "server";                 // no answer at all
  if (status < 400) return "ok";
  if (status < 500) return "client";
  return "server";
}

/** n, min, median and p95 this session. p95 is withheld below five samples: over two it is the larger number wearing a statistic's name. */
function liveStats(samples) {
  const xs = [...(samples ?? [])].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return { n: 0 };
  const mid = xs.length % 2
    ? xs[(xs.length - 1) / 2]
    : Math.round((xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
  const out = { n: xs.length, min: xs[0], median: mid };
  if (xs.length >= 5) out.p95 = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
  return out;
}

/** `n=4 · 17ms · median 22ms · p95 41ms`, withholding what it has not earned. */
function liveStatLine(id) {
  const s = liveStats(LIVE.samples.get(id) ?? []);
  if (!s.n) {
    const cut = LIVE.dropped.get(id) ?? 0;
    return cut ? `no round trip measured · ${cut} truncated at 1 MB` : "";
  }
  const parts = [`n=${s.n}`, `min ${s.min}ms`, `median ${s.median}ms`];
  if (s.p95 != null) parts.push(`p95 ${s.p95}ms`);
  // Named rather than silently absent: "n=3" after five sends is a question.
  const cut = LIVE.dropped.get(id) ?? 0;
  if (cut) parts.push(`${cut} not counted (truncated)`);
  return parts.join(" · ");
}

/** Send for real. The modelled path is unchanged; the response only decides how much of it plays. */
async function liveSend() {
  const ep = REQ.endpoint;
  const flow = ep && reqFlowFor(ep);
  const url = reqUrl();
  if (!ep || !flow || !url || !reqBodyCheck().ok || LIVE.busy) return;

  const st = reqState(ep.id);
  const headers = reqHeaderPairs(st.headers);
  const token = liveToken();
  if (token) headers.Authorization = token;
  const body = reqHasBody(ep.method) && st.body.trim();

  LIVE.busy = true;
  renderInspect();

  let result;
  try {
    const res = await fetch("/api/live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: ep.method,
        // Path only: the origin lives in server config, set by --target.
        path: url,
        headers,
        ...(body ? { body } : {}),
      }),
    });
    result = res.ok
      ? await res.json()
      : { status: null, error: (await res.text()).trim() || `proxy refused (${res.status})` };
  } catch (e) {
    result = { status: null, error: "the atlas server did not answer" };
  }
  LIVE.busy = false;

  // A truncated read's ms is time-to-1MB, not a round trip, so it is not a sample.
  if (result.status != null && !result.error && !result.truncated) {
    const seen = LIVE.samples.get(ep.id) ?? [];
    seen.push(result.ms);
    LIVE.samples.set(ep.id, seen);
  }
  if (result.truncated) LIVE.dropped.set(ep.id, (LIVE.dropped.get(ep.id) ?? 0) + 1);
  LIVE.last.set(ep.id, result);

  const steps = flow.steps.map(reqGrade);
  // Non-2xx stops at hop 1: past it is a modelled path for a journey that failed.
  const ok = result.status != null && result.status < 400;
  const played = ok ? steps : steps.slice(0, 1);
  if (played.length) {
    played[0] = {
      ...played[0],
      sample: {
        request: `${ep.method} ${url}`,
        headers: reqHeaderPairs(reqRedactHeaders(st.headers)),
        ...(body ? { body } : {}),
      },
    };
  }

  S.request = {
    id: `request:${ep.id}`,
    endpointId: ep.id,
    label: `${ep.method} ${url}`,
    steps: played,
    derived: !!flow.derived,
    // On the armed path, never per-step: a step knowing about a response is the
    // first move toward a step carrying a time.
    live: result,
  };
  S.pinnedPacket = null;
  S.running = ok;
  relayout(); renderList(); fitView(); renderInspect(); renderCaption(); syncControls();
}

/** Status ring and latency on the endpoint node only, drawn in the overlay so the raster stays cached. */
function drawLive() {
  const r = S.request?.live;
  if (!r) return;
  // The endpoint id rides on the armed path, keeping this to S, LAYOUT
  // and the render primitives — all of which live in files every harness
  // loads — so a partial module list cannot turn a draw call into a
  // ReferenceError pointing at neither file.
  const n = LAYOUT.nodes.find((x) => x.id === S.request.endpointId);
  if (!n?.top) return;

  const col = THEME.liveStatus?.[liveClassOf(r.status)] ?? THEME.accent;
  ctx.globalAlpha = 0.32;
  quad(ctx, footprintOf(n).map(toScreen), col, null, 0);
  ctx.globalAlpha = 1;
  quad(ctx, silhouetteOf(n).map(toScreen), null, col, 2);

  // The label says what was observed and only that: a status and a duration.
  // A truncated or timed-out read has a number that is not a round trip, so it
  // says so in words instead of printing one.
  const text = r.error ? r.error
    : r.truncated ? `${r.status} · truncated at 1 MB`
    : `${r.status} · ${r.ms}ms`;
  const s = toScreen(n.top);
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = col;
  ctx.fillRect(s.x - w / 2 - 5, s.y - 44, w + 10, 15);
  ctx.fillStyle = BG;
  ctx.fillText(text, s.x, s.y - 33);
}

/**
 * The request as a shell command, without sending it.
 *
 * Prints `$VAR` rather than a token, which is the whole point: the value has
 * never been in this page when the server is injecting it, and the command is
 * still runnable in a shell that has the variable. Built from the target and
 * the composed path, so what it shows is what the proxy would actually send.
 */
function liveCurl() {
  const ep = REQ.endpoint;
  const url = reqUrl();
  if (!ep || !url) return "";
  const origin = LIVE.info?.target ?? "http://TARGET";
  const lines = [`curl -i -X ${ep.method} ${JSON.stringify(origin + url)}`];
  for (const [k, v] of Object.entries(reqHeaderPairs(reqState(ep.id).headers))) {
    if (/^authorization$/i.test(k)) continue;          // handled below, by name
    lines.push(`  -H ${JSON.stringify(`${k}: ${v}`)}`);
  }
  if (LIVE.info?.auth === "env" && LIVE.info.authEnv) {
    lines.push(`  -H "Authorization: $${LIVE.info.authEnv}"`);
  }
  const body = reqHasBody(ep.method) && reqState(ep.id).body.trim();
  if (body) lines.push(`  -d ${JSON.stringify(body)}`);
  return lines.join(" \\\n");
}

/** The MOCK / LIVE control, and everything that only exists in LIVE. */
function renderLiveControls(b) {
  const ep = REQ.endpoint;
  if (!ep) return;

  b.append(el("h3", null, "MODE"));
  const row = el("div", "reqField");
  const mock = el("button", S.mode === "mock" ? "on" : null, "MOCK");
  const liveBtn = el("button", S.mode === "live" ? "on" : null, "LIVE");
  mock.onclick = () => { S.mode = "mock"; renderInspect(); syncControls(); };
  liveBtn.disabled = !liveOffered();
  liveBtn.onclick = () => { S.mode = "live"; renderInspect(); syncControls(); };
  row.append(mock, liveBtn);
  b.append(row);

  if (!liveOffered()) {
    b.append(el("div", "hint", liveReason()));
    return;
  }
  if (S.mode !== "live") {
    b.append(el("div", "hint", "MOCK plays the modelled path and sends nothing."));
    return;
  }

  b.append(el("div", "hint", `LIVE sends this request to ${LIVE.info.target} and reports the status and how long it took. The path drawn afterwards is still modelled.`));

  if (LIVE.info.auth === "env") {
    b.append(el("div", "hint", `AUTH: from $${LIVE.info.authEnv} — the server adds it, and the token never reaches this page.`));
  } else {
    const tok = el("input");
    tok.type = "text";
    tok.value = liveToken() ?? "";
    tok.placeholder = "Authorization: Bearer …";
    tok.oninput = () => liveSetToken(tok.value);
    const wrap = el("div", "reqField");
    wrap.append(el("label", null, "authorization"), tok);
    b.append(wrap);
    const clear = el("button", null, "CLEAR TOKEN");
    clear.onclick = () => { liveSetToken(""); renderInspect(); };
    b.append(clear);
    b.append(el("div", "hint", "Kept for this tab only, never written to disk. Start atlas serve with --auth-env to keep it out of the browser entirely."));
  }

  const stat = liveStatLine(ep.id);
  if (stat) {
    b.append(el("h3", null, "OBSERVED"));
    b.append(el("div", "path", stat));
    b.append(el("div", "hint", "End-to-end, measured by the atlas server. There are no per-hop timings here and never will be: the tool does not watch a request cross an internal hop."));
  }

  b.append(el("h3", null, "AS A SHELL COMMAND"));
  b.append(el("pre", "sample", liveCurl()));
}
