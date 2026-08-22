/* Compose a request against one endpoint and play the path it WOULD take; nothing here sends anything unless LIVE is explicitly on, and real values in a modelled path is the easiest way to make it read as observed, so the MODELED framing is load-bearing. */
const REQ_STORE_KEY = `atlas:compose:${ATLAS.meta.repo}`;
const REQ = { endpoint: null, by: new Map() };
function reqEndpoints() {
  return (ATLAS.endpoints ?? []).slice().sort((a, b) =>
    a.service.localeCompare(b.service) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
function reqParamNames(path) {
  const names = [];
  for (const m of (path ?? "").matchAll(/:(\w+)|\{(\w+)\}/g)) names.push(m[1] ?? m[2]);
  return [...new Set(names)];
}
function reqState(id) {
  if (!REQ.by.has(id)) REQ.by.set(id, { params: {}, query: "", headers: "", body: "" });
  return REQ.by.get(id);
}
function reqHasBody(method) { return method !== "GET" && method !== "HEAD"; }
function reqUrl() {
  const ep = REQ.endpoint;
  if (!ep) return null;
  const st = reqState(ep.id);
  let out = ep.path;
  for (const name of reqParamNames(ep.path)) {
    const v = (st.params[name] ?? "").trim();
    if (!v) return null;
    out = out.replace(`:${name}`, v).replace(`{${name}}`, v);
  }
  const q = st.query.trim().replace(/^\?/, "");
  return q ? `${out}?${q}` : out;
}
function reqBodyCheck() {
  const ep = REQ.endpoint;
  if (!ep || !reqHasBody(ep.method)) return { ok: true, message: "" };
  const text = reqState(ep.id).body.trim();
  if (!text) return { ok: true, message: "empty — no body will be modelled" };
  try {
    const v = JSON.parse(text);
    const n = v && typeof v === "object" ? Object.keys(v).length : 0;
    return { ok: true, message: Array.isArray(v) ? `valid JSON · ${v.length} items` : `valid JSON · ${n} keys` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
function reqHeaderPairs(text) {
  const out = {};
  for (const line of (text ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
function reqRedactHeaders(text) {
  return (text ?? "").split("\n").map((line) => {
    const i = line.indexOf(":");
    if (i < 1) return line;
    return /^authorization$/i.test(line.slice(0, i).trim()) ? `${line.slice(0, i)}:` : line;
  }).join("\n");
}
function reqSave() {
  try {
    const out = {};
    for (const [id, st] of REQ.by) out[id] = { ...st, headers: reqRedactHeaders(st.headers) };
    sessionStorage.setItem(REQ_STORE_KEY, JSON.stringify(out));
  } catch { }
}
function reqLoad() {
  try {
    const raw = sessionStorage.getItem(REQ_STORE_KEY);
    if (!raw) return;
    for (const [id, st] of Object.entries(JSON.parse(raw))) {
      REQ.by.set(id, { params: {}, query: "", headers: "", body: "", ...st });
    }
  } catch { }
}
function reqCuratedFlow(ep) {
  const id = (byId.get(ep.id)?.travelledBy ?? [])[0];
  return id ? flowById.get(id) ?? null : null;
}
function reqFlowFor(ep) {
  return reqCuratedFlow(ep) ?? flowById.get(`derived:${ep.id}`) ?? null;
}
function reqOverviewFlows() {
  const seen = new Set(), out = [];
  for (const ep of reqEndpoints()) {
    const f = reqFlowFor(ep);
    if (f && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
  }
  return out;
}
function reqHopEvidence(step) {
  const ep = srcEndpoint(step.from);
  if (ep) return { path: ep.definedIn, line: ep.line, label: "⤷ ROUTE IN" };
  const imp = srcHopImport(step);
  return imp ? { ...imp, label: "⤷ IMPORT IN" } : null;
}
function reqHopJump(step) {
  const ev = reqHopEvidence(step);
  return ev ? srcJump(ev.label, ev.path, ev.line) : null;
}
function reqGrade(step) {
  const graded = step.certainty ? { ...step } : { ...step,
    certainty: (edgesFrom.get(step.from) ?? []).some((e) => e.to === step.to && e.kind === "import") ? "imported" : "inferred" };
  if (graded.certainty !== "inferred" && !reqHopEvidence(graded)) graded.certainty = "inferred";
  graded.inferred = graded.certainty === "inferred";
  return graded;
}
function reqSend() {
  const ep = REQ.endpoint;
  const flow = ep && reqFlowFor(ep);
  const url = reqUrl();
  if (!ep || !flow || !url || !reqBodyCheck().ok) return;
  const st = reqState(ep.id);
  const body = reqHasBody(ep.method) && st.body.trim();
  const steps = flow.steps.map(reqGrade);
  if (steps.length) {
    let parsed = null;
    if (body) { try { parsed = JSON.parse(body); } catch { parsed = body; } }
    steps[0] = { ...steps[0], sample: {
      request: `${ep.method} ${url}`,
      headers: reqHeaderPairs(reqRedactHeaders(st.headers)),
      ...(parsed === null ? {} : { body: parsed }) } };
  }
  S.request = { id: `request:${ep.id}`, label: `${ep.method} ${url}`, steps, derived: !!flow.derived };
  S.pinnedPacket = null;
  S.running = true;
  relayout(); renderList(); fitView(); renderInspect(); renderCaption(); syncControls();
}
function reqCurateSource() {
  const ep = REQ.endpoint;
  const flow = S.request;
  if (!ep || !flow) return "";
  const id = `${ep.method}-${ep.path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const steps = flow.steps.map((s) =>
    `    { from: ${JSON.stringify(s.from)}, to: ${JSON.stringify(s.to)}, kind: ${JSON.stringify(s.kind ?? "request")} },`);
  return ["{", `  id: ${JSON.stringify(id)},`, `  label: ${JSON.stringify(`${ep.method} ${ep.path}`)},`,
    `  view: "requests",`,
    `  blurb: "Curated from the composer. These hops were the modelled path; edit them to what really happens.",`,
    "  steps: [", ...steps, "  ],", "}"].join("\n");
}
function renderRequestList(wrap, title, count) {
  const eps = reqEndpoints();
  title.textContent = "ENDPOINTS";
  count.textContent = eps.length;
  for (const ep of eps) {
    const r = el("button", "row" + (REQ.endpoint?.id === ep.id ? " sel" : ""));
    const curated = !!reqCuratedFlow(ep);
    r.append(el("span", "mk", ep.method), el("span", "nm", ep.path), el("span", "sub", curated ? "curated" : ep.service));
    r.onclick = () => {
      REQ.endpoint = ep;
      S.request = reqFlowFor(ep); S.pinnedPacket = null; S.selected = null;
      relayout(); renderList(); renderInspect(); renderCaption(); syncControls();
    };
    wrap.append(r);
  }
}
function reqField(label, hint, value, rows, onInput) {
  const wrap = el("div", "reqField");
  wrap.append(el("label", null, label));
  const input = rows ? el("textarea") : el("input");
  if (rows) input.rows = rows; else input.type = "text";
  input.value = value ?? "";
  if (hint) input.placeholder = hint;
  input.oninput = () => onInput(input.value);
  input.onchange = () => reqSave();
  wrap.append(input);
  return wrap;
}
function renderComposer(b) {
  const eps = reqEndpoints();
  if (!eps.length) {
    b.append(el("div", "hint", "This repository has no endpoints, so there is nothing to compose a request against."));
    return;
  }
  const ep = REQ.endpoint;
  if (!ep) {
    b.append(el("div", "hint", `All ${reqOverviewFlows().length} known request paths are lit on the map at once. Pick one of the ${eps.length} endpoints on the left to focus just that path, or compose one below.`));
    return;
  }
  const st = reqState(ep.id);
  b.append(el("div", "eyebrow", ep.method));
  b.append(el("div", "title", ep.path));
  b.append(el("div", "path", `${ep.definedIn}:${ep.line}`));
  const route = srcJump("⤷ ROUTE IN", ep.definedIn, ep.line);
  if (route) b.append(route);
  const names = reqParamNames(ep.path);
  if (names.length) {
    b.append(el("h3", null, "PATH PARAMETERS"));
    for (const name of names) b.append(reqField(name, "required", st.params[name], 0, (v) => { st.params[name] = v; renderInspect(); }));
  }
  b.append(el("h3", null, "QUERY"));
  b.append(reqField("query string", "page=2&sort=name", st.query, 0, (v) => { st.query = v; renderInspect(); }));
  b.append(el("h3", null, "HEADERS"));
  b.append(reqField("one per line", "Accept: application/json", st.headers, 3, (v) => { st.headers = v; }));
  b.append(el("div", "hint", "An authorization value is kept for this session only and never written to storage. The header name comes back, empty."));
  const check = reqBodyCheck();
  if (reqHasBody(ep.method)) {
    b.append(el("h3", null, "JSON BODY"));
    b.append(reqField("body", '{ "name": "…" }', st.body, 5, (v) => { st.body = v; renderInspect(); }));
    b.append(el("div", check.ok ? "hint" : "note warn", check.message));
  }
  const url = reqUrl();
  const flow = reqFlowFor(ep);
  b.append(el("h3", null, "COMPOSED"));
  b.append(el("div", "path", url ? `${ep.method} ${url}` : "fill every path parameter to compose this request"));
  // Live mode is re-grafted here: the design this was ported from had no server behind it and stubbed the send. MOCK stays the default and LIVE is never inferred — see 79-live.js.
  const liveNow = S.mode === "live" && liveOffered();
  const send = el("button", null, liveNow ? "SEND (LIVE)" : "SEND (MODELED)");
  send.style.marginTop = "9px";
  send.disabled = !url || !check.ok || !flow || LIVE.busy;
  send.onclick = () => (liveNow ? liveSend() : reqSend());
  b.append(send);
  if (LIVE.busy) b.append(el("div", "hint", "waiting for the target…"));
  if (!flow) b.append(el("div", "note warn", "No path can be played for this endpoint: nobody curated one, and derivation found none through the import graph."));

  renderLiveControls(b);

  if (!S.request) return;

  // The status is observed and the hops are not, so they are kept visually apart.
  const observed = S.request.live;
  if (observed) {
    b.append(el("h3", null, "RESPONSE · OBSERVED"));
    b.append(el("div", observed.error ? "note warn" : "path",
      observed.error ? observed.error
        : `${observed.status} ${observed.statusText ?? ""} · ${observed.ms}ms${observed.truncated ? " · truncated at 1 MB" : ""}`));
    if (observed.redirected) b.append(el("div", "hint", "A redirect, reported and not followed."));
    if (observed.status != null && observed.status >= 400) {
      b.append(el("div", "hint", "The path below stops at the first hop: the request reached the endpoint, and everything past it is a route this tool modelled for a journey that did not finish."));
    }
  }
  b.append(el("h3", null, S.request.derived ? "HOPS · DERIVED" : "HOPS · CURATED"));
  b.append(el("div", "hint", S.request.derived
    ? "This path was inferred from the import graph. A dotted hop has nothing behind it and is offered no line to open."
    : "A person asserted this ordering. Imports cannot express it, so the hops are still modelled; a dotted one has no import behind it."));
  for (const [i, s] of S.request.steps.entries()) {
    const r = el("div", "row mini");
    r.append(el("span", "nm", `${byId.get(s.from)?.name ?? s.from} → ${byId.get(s.to)?.name ?? s.to}`));
    r.append(el("span", "sub", CERTAINTY_LABEL[s.certainty]?.split(" — ")[0] ?? s.certainty));
    r.onclick = () => selectStep({ ...s, i, flowId: S.request.id });
    const jump = reqHopJump(s);
    if (jump) r.append(jump);
    b.append(r);
  }
  b.append(el("h3", null, "CURATE THIS"));
  b.append(el("div", "hint", "Paste this into your config's flows array to assert the path instead of inferring it. Edit the hops to what really happens first: this is the tool's guess, and curating it makes it your claim."));
  b.append(el("pre", "sample", reqCurateSource()));
  const copy = el("button", null, "COPY");
  copy.onclick = () => {
    navigator.clipboard?.writeText(reqCurateSource()).then(
      () => { copy.textContent = "COPIED"; },
      () => { copy.textContent = "SELECT THE TEXT ABOVE"; });
  };
  b.append(copy);
}
