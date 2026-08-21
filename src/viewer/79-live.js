/* ════════════════════ live mode ════════════════════
 *
 * The one place this tool shows something it actually watched happen.
 *
 * Everything else on the map is read from the repository or inferred from it.
 * A live send produces two genuinely observed facts — a status code and an
 * end-to-end duration — and the entire difficulty of this file is that those
 * two facts arrive sitting next to a path the tool only modelled.
 *
 * THREE RULES, and they are the reason the phase was built last.
 *
 * The status is observed. The path is not. A green ring on the endpoint node
 * says the endpoint answered; it says nothing whatsoever about the hops drawn
 * behind it, which came from the import graph exactly as they did in MOCK.
 * `#ovWarn` carries that sentence for the whole animation.
 *
 * A non-2xx halts at hop 1. Animating a success path underneath a 500 would be
 * the map asserting a journey that demonstrably did not complete.
 *
 * NO PER-HOP TIMINGS, EVER. `ms / steps.length` is one line away and would look
 * entirely reasonable in a diff. It is a fabrication: the tool never watches a
 * request cross an internal hop, so any number attached to one is invented.
 * `test/live-view.test.mjs` asserts structurally that no step object ever grows
 * a timing field, which is there to make writing that line fail.
 *
 * The proxy also never returns a response body, so there is nothing here that
 * could render one. That is a server-side guarantee (`src/serve/proxy.mjs`) and
 * this file depends on it rather than re-checking it.
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

/**
 * Can this page send a real request at all?
 *
 * `srcServed()`, deliberately, and not `srcCapable()`. An atlas built with
 * `--embed-source` and opened as a file is source-capable — it carries the code
 * — but there is no server behind it to proxy through. 72-source.js already
 * draws that distinction and this is the other side of it.
 */
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

/**
 * Store the page's own token, for the session and no longer.
 *
 * sessionStorage rather than localStorage, and never with the composer's other
 * fields: 78-request.js redacts an authorization VALUE out of what it persists,
 * and this is the deliberate exception a reader opted into by typing it here.
 * It dies with the tab, and the CLEAR control makes that a thing you can do on
 * purpose rather than by closing the browser.
 */
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

/**
 * `n`, min, median and p95 over this session's samples.
 *
 * Lives here rather than beside the proxy because the viewer is its only
 * caller and cannot import from `src/` anyway — the bundle is concatenated
 * script, not modules.
 *
 * **p95 is withheld below five samples.** A 95th percentile over two numbers is
 * not a percentile, it is the larger number wearing a statistic's name, and a
 * tool that refuses to invent per-hop timings has no business inventing this
 * either. `n` always ships, so the reader can weigh the rest of it.
 */
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
  // Named rather than silently absent: "n=3" when you pressed send five times
  // is a question, and this is the answer to it.
  const cut = LIVE.dropped.get(id) ?? 0;
  if (cut) parts.push(`${cut} not counted (truncated)`);
  return parts.join(" · ");
}

/**
 * Send the composed request for real, and arm what came back.
 *
 * The modelled path is still the modelled path: this reuses the same flow
 * 78-request.js would have played, and the only thing the response changes is
 * how much of it plays and what the endpoint node wears.
 */
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
        // The path only. The page has never had a host to send and never will:
        // the origin lives in the server's config, set by --target.
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

  // A truncated read's ms is time-to-1MB, not time-to-completion, so it is not
  // a round trip and does not belong in a statistic labelled end-to-end.
  // drawLive already refuses to print it as a number; letting it into the
  // samples would have smuggled it back in as a median that quietly understates
  // every endpoint returning a large body.
  if (result.status != null && !result.error && !result.truncated) {
    const seen = LIVE.samples.get(ep.id) ?? [];
    seen.push(result.ms);
    LIVE.samples.set(ep.id, seen);
  }
  if (result.truncated) LIVE.dropped.set(ep.id, (LIVE.dropped.get(ep.id) ?? 0) + 1);
  LIVE.last.set(ep.id, result);

  const steps = flow.steps.map(reqGrade);
  // A response that did not succeed stops the trace at the first hop. The
  // request reached the endpoint — that much is observed — and everything past
  // it is a path the tool modelled for a journey that did not finish.
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
    // Marks the ARMED PATH as having come from a live send. It is deliberately
    // not a per-step field: a step knowing about a response is the first move
    // toward a step carrying a time, which is the one thing this must not do.
    live: result,
  };
  S.pinnedPacket = null;
  S.running = ok;
  relayout(); renderList(); fitView(); renderInspect(); renderCaption(); syncControls();
}

/**
 * The status ring and its latency, on the endpoint node and nowhere else.
 *
 * Drawn in the overlay pass rather than the static raster: the static layer is
 * cached and re-rasterising it is what the Phase 1 and 2.5 gates forbid on
 * anything that is not a layout change. Reuses the exact shapes selection and
 * findings already use for "this one node, in place".
 */
function drawLive() {
  const r = S.request?.live;
  if (!r) return;
  // The endpoint id rides on the armed path rather than being read back out of
  // the composer's state. That keeps this function's dependencies to S, LAYOUT
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
