/* ════════════════════ request composer ════════════════════
 *
 * Compose a request against one endpoint, then watch the path it would take.
 *
 * WOULD. Nothing here sends anything. The map already knows the endpoints and
 * already derives a path through the code for each one; this view lets a reader
 * put real values into that path and play it, which is a different question
 * from "what happened" and has to keep reading like one. Three things hold that
 * line, and none of them is decoration: the button says MODELED, the composed
 * request is shown under the panel's existing PACKET PAYLOAD (SYNTHETIC)
 * heading, and the canvas badge stays up for the whole animation.
 *
 * Substituting real values into a modelled path is the single easiest way to
 * make a modelled path read as an observed one, so the honesty contract is
 * load-bearing here rather than ambient.
 *
 * DELIBERATELY UNDER-BUILT. Query and headers are one text field each, not rows
 * of key/value inputs. Rows are the first step toward saved collections and
 * environments, and PLAN.md's scope guard names "like Postman" as the thing
 * this is not. A reader who wants a request client has one already.
 */

/** Per-repo, so two atlases open in one browser do not share a composer. */
const REQ_STORE_KEY = `atlas:compose:${ATLAS.meta.repo}`;

/** Which endpoint is open, and what has been typed against each one. */
const REQ = { endpoint: null, by: new Map() };

/** Endpoints, grouped the way the map is: service first, then path. */
function reqEndpoints() {
  return (ATLAS.endpoints ?? []).slice().sort((a, b) =>
    a.service.localeCompare(b.service) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * The path parameters in a route, in both syntaxes the payload can carry.
 * `docs/payload-schema.md` promises `path` is the source's own text, so `:id`
 * and `{id}` both appear depending on which framework wrote the route.
 */
function reqParamNames(path) {
  const names = [];
  for (const m of (path ?? "").matchAll(/:(\w+)|\{(\w+)\}/g)) names.push(m[1] ?? m[2]);
  return [...new Set(names)];
}

/** The composer record for an endpoint, created empty on first ask. */
function reqState(id) {
  if (!REQ.by.has(id)) REQ.by.set(id, { params: {}, query: "", headers: "", body: "" });
  return REQ.by.get(id);
}

/** Does this method carry a body? GET and HEAD are offered no body field. */
function reqHasBody(method) {
  return method !== "GET" && method !== "HEAD";
}

/**
 * The composed path, or null when a parameter is still blank.
 *
 * Null rather than a path with `:id` left in it: a half-substituted URL looks
 * like a real one, and the whole point of the readout is to say which it is.
 */
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

/** `{ ok, message }` for the body field — the live validity readout. */
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

/** `Name: value` lines to an object, for the modelled packet's payload. */
function reqHeaderPairs(text) {
  const out = {};
  for (const line of (text ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * Strip an authorization VALUE, keeping its name.
 *
 * Applied at every boundary the value could leave memory by: sessionStorage,
 * and the packet payload the panel renders into the DOM. The name survives on
 * purpose — a header row that vanishes on reload reads as a bug, one that comes
 * back empty reads as a decision, and only the second is true.
 */
function reqRedactHeaders(text) {
  return (text ?? "").split("\n").map((line) => {
    const i = line.indexOf(":");
    if (i < 1) return line;
    return /^authorization$/i.test(line.slice(0, i).trim()) ? `${line.slice(0, i)}:` : line;
  }).join("\n");
}

/**
 * Persist the composer, minus any authorization value.
 *
 * Wrapped because `sessionStorage` is not merely empty in a hardened browser or
 * on a `file:` page — reading the property itself throws — and an atlas that
 * cannot remember a field must still be an atlas.
 */
function reqSave() {
  try {
    const out = {};
    for (const [id, st] of REQ.by) out[id] = { ...st, headers: reqRedactHeaders(st.headers) };
    sessionStorage.setItem(REQ_STORE_KEY, JSON.stringify(out));
  } catch { /* no persistence here; the composer still works for this session */ }
}

function reqLoad() {
  try {
    const raw = sessionStorage.getItem(REQ_STORE_KEY);
    if (!raw) return;
    for (const [id, st] of Object.entries(JSON.parse(raw))) {
      REQ.by.set(id, { params: {}, query: "", headers: "", body: "", ...st });
    }
  } catch { /* unreadable or unavailable; start empty */ }
}

/** A curated flow that passes through this endpoint, if a person wrote one. */
function reqCuratedFlow(ep) {
  const id = (byId.get(ep.id)?.travelledBy ?? [])[0];
  return id ? flowById.get(id) ?? null : null;
}

/**
 * The path to play: curation first, derivation second.
 *
 * A person's assertion outranks this tool's inference, which is the same order
 * `atlas build` uses when it decides which flows to ship.
 */
function reqFlowFor(ep) {
  return reqCuratedFlow(ep) ?? flowById.get(`derived:${ep.id}`) ?? null;
}

/**
 * The import (or route registration) that justifies a hop, as data.
 *
 * Separate from the button below on purpose. Whether evidence EXISTS is a fact
 * about the repository; whether a jump can be offered also depends on there
 * being a server to read the file from. Grading a hop on the second would mark
 * every hop inferred on a page opened as a plain file, which is a different lie
 * from the one this is here to prevent.
 */
function reqHopEvidence(step) {
  const ep = srcEndpoint(step.from);
  if (ep) return { path: ep.definedIn, line: ep.line, label: "⤷ ROUTE IN" };
  const imp = srcHopImport(step);
  return imp ? { ...imp, label: "⤷ IMPORT IN" } : null;
}

/** The jump control for a hop, or null when there is nothing honest to open. */
function reqHopJump(step) {
  const ev = reqHopEvidence(step);
  return ev ? srcJump(ev.label, ev.path, ev.line) : null;
}

/**
 * Grade one hop, and refuse to draw a solid line we cannot back.
 *
 * A curated step carries no certainty — a person asserted the ordering, not the
 * mechanism — so every hop of a curated flow would otherwise draw solid, which
 * is exactly the case the honesty contract exists for. Graded here, at clone
 * time, so no payload field changes and no golden moves.
 *
 * The second half matters more than the first: a step that grades justified but
 * has no evidence behind it is regraded `inferred` rather than drawn solid. The
 * checkbox says "every solid hop opens the import line that justifies it", and
 * this is the only reading of that where the map cannot overstate itself.
 */
function reqGrade(step) {
  const graded = step.certainty
    ? { ...step }
    : {
      ...step,
      certainty: (edgesFrom.get(step.from) ?? []).some((e) => e.to === step.to && e.kind === "import")
        ? "imported" : "inferred",
    };
  if (graded.certainty !== "inferred" && !reqHopEvidence(graded)) graded.certainty = "inferred";
  graded.inferred = graded.certainty === "inferred";
  return graded;
}

/**
 * Arm the composed request as the played path.
 *
 * The substituted request rides on the first step's `sample`, which the INFO
 * panel already renders under PACKET PAYLOAD (SYNTHETIC) — the honest framing
 * for this, already written, for a reason that now has a second use.
 */
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
    steps[0] = {
      ...steps[0],
      sample: {
        request: `${ep.method} ${url}`,
        headers: reqHeaderPairs(reqRedactHeaders(st.headers)),
        ...(parsed === null ? {} : { body: parsed }),
      },
    };
  }

  S.request = { id: `request:${ep.id}`, label: `${ep.method} ${url}`, steps, derived: !!flow.derived };
  S.pinnedPacket = null;
  S.running = true;
  relayout(); renderList(); fitView(); renderInspect(); renderCaption(); syncControls();
}

/**
 * The curated-flow entry this composed path would become, as pasteable source.
 *
 * Ids are repository paths and can hold anything, so every one goes through
 * JSON.stringify rather than into a template literal. Certainty is deliberately
 * not emitted: it is this tool's grading of its own inference, and a person
 * pasting a flow into a config is asserting the path, not quoting the guess.
 */
function reqCurateSource() {
  const ep = REQ.endpoint;
  const flow = S.request;
  if (!ep || !flow) return "";
  const id = `${ep.method}-${ep.path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const steps = flow.steps.map((s) =>
    `    { from: ${JSON.stringify(s.from)}, to: ${JSON.stringify(s.to)}, kind: ${JSON.stringify(s.kind ?? "request")} },`);
  return [
    "{",
    `  id: ${JSON.stringify(id)},`,
    `  label: ${JSON.stringify(`${ep.method} ${ep.path}`)},`,
    `  view: "requests",`,
    `  blurb: "Curated from the composer. These hops were the modelled path; edit them to what really happens. Pasting this adds a REQUESTS view to the strip.",`,
    "  steps: [",
    ...steps,
    "  ],",
    "}",
  ].join("\n");
}

/** The sidebar list: every endpoint the scan found. */
function renderRequestList(wrap, title, count) {
  const eps = reqEndpoints();
  title.textContent = "ENDPOINTS";
  count.textContent = eps.length;
  for (const ep of eps) {
    const r = el("button", "row" + (REQ.endpoint?.id === ep.id ? " sel" : ""));
    r.append(el("span", "mk", ep.method), el("span", "nm", ep.path), el("span", "sub", ep.service));
    r.onclick = () => {
      REQ.endpoint = ep;
      S.request = null; S.pinnedPacket = null; S.selected = null;
      relayout(); renderList(); renderInspect(); renderCaption(); syncControls();
    };
    wrap.append(r);
  }
}

/** One labelled field. `rows` makes it a textarea instead of an input. */
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

/** The composer panel. */
function renderComposer(b) {
  const eps = reqEndpoints();
  if (!eps.length) {
    b.append(el("div", "hint", "This repository has no endpoints, so there is nothing to compose a request against."));
    return;
  }
  const ep = REQ.endpoint;
  if (!ep) {
    b.append(el("div", "hint", `Pick one of the ${eps.length} endpoints on the left. Nothing is sent: composing one plays the path it would take through this code, which the tool modelled rather than watched.`));
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
    for (const name of names) {
      b.append(reqField(name, "required", st.params[name], 0, (v) => {
        st.params[name] = v;
        renderInspect();
      }));
    }
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

  const liveNow = S.mode === "live" && liveOffered();
  const send = el("button", null, liveNow ? "SEND (LIVE)" : "SEND (MODELED)");
  send.style.marginTop = "9px";
  send.disabled = !url || !check.ok || !flow || LIVE.busy;
  send.onclick = () => (liveNow ? liveSend() : reqSend());
  b.append(send);
  if (LIVE.busy) b.append(el("div", "hint", "waiting for the target…"));
  if (!flow) {
    b.append(el("div", "note warn", "No path can be played for this endpoint: nobody curated one, and derivation found none through the import graph."));
  }

  renderLiveControls(b);

  if (!S.request) return;

  // What the target actually said, kept apart from the hops below it: the
  // status is observed, the hops are not, and the two must not read as one
  // block of findings about the same thing.
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
    // Clipboard access needs a secure context, which a file:// atlas is not.
    // The text is on screen either way, so a failure is not worth a message.
    navigator.clipboard?.writeText(reqCurateSource()).then(
      () => { copy.textContent = "COPIED"; },
      () => { copy.textContent = "SELECT THE TEXT ABOVE"; });
  };
  b.append(copy);
}

reqLoad();
