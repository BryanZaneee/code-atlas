/**
 * The live-proxy security core: pure, socket-free decisions about what the
 * page composer is allowed to send, and where. Nothing in this file opens a
 * connection — `forward()`, the one function that does, lands in a later
 * commit on purpose, so this file's entire refusal surface can be reviewed
 * and tested before anything here can reach a network.
 *
 * The idiom mirrors `resolveAllowed` in server.mjs: a pure, exported
 * function that returns the thing to do, or a refusal, never a thrown
 * exception for an expected shape of "no". The one deliberate divergence:
 * `resolveAllowed` returns null on refusal, but here the refusal carries a
 * **reason**, because the composer UI has to say why a request was refused.
 *
 * `ms / hops.length` is one line away from every place this file's numbers
 * end up rendered, and must never be written — a modelled hop must never
 * read as an observed one. Nothing in this file computes it; say so here so
 * the next person who reaches for it finds this comment first.
 */
import net from "node:net";

/**
 * Methods this proxy will ever forward. This happens to be the same seven
 * verbs `src/model/endpoints.mjs` recognizes in route declarations, but the
 * two lists mean different things — "a method a route may declare" versus
 * "a method this proxy will send" — and importing across that seam to save
 * a seven-element array would be a worse coupling than the duplication.
 * Kept in sync by hand, not by import.
 */
export const LIVE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Headers the page composer may set directly. `authorization` is
 * deliberately absent — it has its own two-mode rule in `resolveOutbound`,
 * because it is the one header this server sometimes injects itself.
 * `user-agent` is absent too: it is always set server-side to
 * `atlas/serve`, so the upstream sees who is really asking, not whatever a
 * page-composed request happened to claim.
 */
export const LIVE_HEADERS = ["accept", "accept-language", "content-type", "if-match", "if-none-match", "x-request-id", "x-requested-with"];

/** Composer request body cap. Enforced here on the parsed value, and again while streaming the raw body in `readBody()`. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Upstream response cap, enforced by `forward()` while reading. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Per-request upstream timeout, enforced by `forward()`. */
export const LIVE_TIMEOUT_MS = 10_000;

/* ════════════════════ the loopback/private-host check ════════════════════
 *
 * No DNS resolution happens here, anywhere. Resolving at validation time and
 * connecting by hostname later is TOCTOU against our own outbound leg — the
 * same rebind class `sameOrigin()`'s Host pinning defends against inbound,
 * and it would be perverse to defend one direction and leave the other
 * open. Resolving and connecting by IP instead would break SNI and vhost
 * routing, and needs a custom `lookup` hook the global `fetch` does not
 * offer.
 *
 * So: purely syntactic on the hostname the operator typed. A hostname that
 * *resolves* to a private address (a `/etc/hosts` alias, a split-horizon
 * DNS entry) is refused — `myapp.local` will not work; type
 * `http://127.0.0.1:3000` instead. That is the failure direction this
 * design accepts: "atlas would not talk to my dev alias", never "atlas
 * fetched the metadata service".
 *
 * Two residuals, named rather than implied: `localhost` could itself be
 * repointed via `/etc/hosts` (needs local root — whoever holds that already
 * owns the process anyway); and a loopback target could redirect outward,
 * which is why `redirect: "manual"` in `forward()` is a SECURITY CONTROL,
 * not a UX nicety — a followed 302 to 169.254.169.254 would launder every
 * check below.
 */

function parseIPv4(hostname) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/**
 * Numeric-octet classification shared by plain IPv4 and an IPv4 address
 * embedded in an IPv6 literal (`::ffff:a.b.c.d`). Every comparison here is
 * on the parsed integer, never on the string — `172.32.0.1` and
 * `172.15.0.1` both look like "172." to a `startsWith` check but sit
 * outside 172.16.0.0/12, and a string-prefix match would wrongly let both
 * through.
 */
function isPrivateIPv4Octets([a, b]) {
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false; // includes 169.254/16 and 0.0.0.0/8's other members — see isPrivateHost
}

/**
 * Expand an IPv6 literal (as returned by `URL#hostname`, i.e. no brackets)
 * to eight 16-bit groups, or null if it does not parse. Handles `::`
 * compression and an embedded IPv4 tail (`::ffff:127.0.0.1`).
 */
function expandIPv6(hostname) {
  if (!net.isIPv6(hostname)) return null;

  const toGroups = (parts) => {
    const groups = [];
    for (const part of parts) {
      if (part === "") continue;
      if (part.includes(".")) {
        const v4 = part.split(".").map(Number);
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        groups.push(parseInt(part, 16));
      }
    }
    return groups;
  };

  if (hostname.includes("::")) {
    const [head, tail] = hostname.split("::");
    const headG = toGroups(head ? head.split(":") : []);
    const tailG = toGroups(tail ? tail.split(":") : []);
    const fill = 8 - headG.length - tailG.length;
    if (fill < 0) return null;
    return [...headG, ...Array(fill).fill(0), ...tailG];
  }
  const g = toGroups(hostname.split(":"));
  return g.length === 8 ? g : null;
}

/**
 * @returns whether `hostname` is a loopback or private-network host this
 * proxy may target. See the block comment above for what this deliberately
 * does not do (DNS), and the table in the design spec for the full range
 * list this mirrors.
 */
export function isPrivateHost(hostname) {
  if (typeof hostname !== "string" || hostname === "") return false;
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const v4 = parseIPv4(host);
  if (v4) {
    const [a, b] = v4;
    // 169.254.0.0/16 is link-local, and it is where cloud metadata lives
    // (169.254.169.254) — the one place "private" and "safe" diverge, so it
    // is refused by name rather than being left to fall through the
    // RFC1918 ranges below.
    if (a === 169 && b === 254) return false;
    if (a === 0) return false; // 0.0.0.0 is a bind address, not a destination
    return isPrivateIPv4Octets(v4);
  }

  const v6 = expandIPv6(host);
  if (v6) {
    if (v6.every((g) => g === 0)) return false; // :: — the v6 analogue of 0.0.0.0
    if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return true; // ::1 — loopback
    if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
      // ::ffff:a.b.c.d — an IPv4 address mapped into v6. Classify the
      // embedded address by the same numeric rule as plain IPv4, including
      // the 169.254 carve-out.
      const a = v6[6] >> 8, b = v6[6] & 0xff;
      if (a === 169 && b === 254) return false;
      if (a === 0) return false;
      return isPrivateIPv4Octets([a, b]);
    }
    // fe80::/10 — link-local, the v6 sibling of 169.254/16 and the address
    // family cloud metadata services also answer on.
    if (v6[0] >= 0xfe80 && v6[0] <= 0xfebf) return false;
    // fc00::/7 — unique local addresses. Private-network-shaped, but this
    // syntactic allowlist only covers what it explicitly recognizes, and
    // ULA space is not on that list.
    if (v6[0] >= 0xfc00 && v6[0] <= 0xfdff) return false;
    return false;
  }

  return false; // any other string is a hostname atlas will not resolve
}

/* ══════════════════════ what --target may name ══════════════════════ */

// Requires "://" so a bare `host:port` spec (e.g. `localhost:3000`,
// `app.localhost:3000`) is never mistaken for a scheme — both would
// otherwise match `^[a-zA-Z][a-zA-Z0-9+.-]*:` since scheme names may
// contain letters and dots.
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Validate a `--target` spec into an origin, or refuse with a reason.
 * Accepts a bare `host[:port]` (the expected shape) as well as a full
 * `http://`/`https://` origin.
 *
 * @returns {{ok:true,origin:string}|{ok:false,reason:string}}
 */
export function resolveTarget(spec) {
  if (typeof spec !== "string" || spec.trim() === "") {
    return { ok: false, reason: `"${spec}" is not a valid target — expected a host or origin, e.g. 127.0.0.1:3000` };
  }

  const candidate = HAS_SCHEME.test(spec) ? spec : `http://${spec}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: `"${spec}" is not a valid target` };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `scheme "${url.protocol}" is not allowed — only http and https targets are proxied` };
  }

  // Credentials in the URL would become an Authorization header the log
  // line never sees — the same "the token cannot escape" reasoning that
  // keeps the env token out of resolveOutbound, applied to a second place a
  // secret could hide.
  if (url.username || url.password) {
    return { ok: false, reason: "credentials in the target are refused — they would become an Authorization header the log line never sees" };
  }

  // A target is an origin, not a path: accepting one here would create a
  // second place a route prefix could come from, alongside the composer's
  // own `path` on every request.
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { ok: false, reason: `a target is an origin, not a path — remove "${url.pathname}${url.search}${url.hash}"` };
  }

  if (!isPrivateHost(unbracket(url.hostname))) {
    return { ok: false, reason: `"${url.hostname}" is not a loopback or private-network host — atlas does not resolve DNS, so type the IP directly` };
  }

  return { ok: true, origin: url.origin };
}

/* ══════════════════════ what the page composer may send ══════════════════════ */

// Node's URL#hostname keeps the brackets around an IPv6 literal
// (`"[::1]"`), unlike the hostname a bare socket address would use.
// isPrivateHost expects the bare form, so every caller strips them here
// rather than teaching isPrivateHost two input shapes.
function unbracket(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The pure decision behind `POST /api/live`: given the server's fixed
 * `live` config and the JSON body the page sent, build the exact request
 * `forward()` will make, or refuse with a reason the UI can show.
 *
 * `resolveOutbound` never reads `live.token` — the env-injected secret is
 * added by `forward()`, one line before `fetch`, and this function's return
 * value never carries it. A page-supplied `Authorization` header (the
 * sessionStorage fallback, only reachable when no env token is configured)
 * is a different value entirely and is forwarded as typed; it is never
 * `live.token` and does not weaken that guarantee.
 *
 * @returns {{ok:true,url:string,method:string,headers:object,body:(string|undefined)}|{ok:false,reason:string}}
 */
export function resolveOutbound(live, req) {
  if (!live || typeof live.origin !== "string") {
    return { ok: false, reason: "live mode is off" };
  }

  // Re-asserted per request, socket-free: cheap, keeps this function total,
  // and is what lets "refuses a non-loopback target" be a fact this file's
  // own tests can assert without a server ever having existed.
  let originHost;
  try {
    originHost = new URL(live.origin).hostname;
  } catch {
    return { ok: false, reason: "live target is not a valid origin" };
  }
  if (!isPrivateHost(unbracket(originHost))) {
    return { ok: false, reason: "live target is not a loopback or private-network host" };
  }

  if (!isPlainObject(req)) {
    return { ok: false, reason: "request must be an object" };
  }

  const method = typeof req.method === "string" ? req.method.toUpperCase() : null;
  if (!method || !LIVE_METHODS.includes(method)) {
    return { ok: false, reason: `method "${req.method}" is not allowed — atlas proxies GET POST PUT PATCH DELETE HEAD OPTIONS` };
  }

  if (typeof req.path !== "string") {
    return { ok: false, reason: "path must be a string" };
  }

  let target;
  try {
    target = new URL(req.path, live.origin);
  } catch {
    return { ok: false, reason: `path "${req.path}" is not a valid path` };
  }
  // The origin check is the defense here, not path purity. `/a/../../etc`
  // is ALLOWED and normalizes to `origin + "/etc"` — dot-segments that
  // never leave the origin are harmless, and refusing them would be
  // punishing a shape rather than an attack. What IS refused is anything
  // that changes the origin: a protocol-relative path (`//example.com/x`),
  // or a leading backslash (`/\/example.com`), which WHATWG URL parsing
  // normalizes to `/` for special schemes — `/\/example.com` becomes
  // `//example.com`, a network-path reference that replaces the host
  // entirely. Both are caught here, by the same check, without special
  //-casing either shape.
  // Refused by name here for the same reason resolveTarget refuses it in a
  // target: credentials become an Authorization the log line never sees. Node's
  // fetch happens to reject these too, but it collapses to a generic
  // "unreachable", and a refusal nobody can read is the thing this file's
  // header argues against.
  if (target.username || target.password) {
    return { ok: false, reason: "a path must not carry credentials" };
  }
  if (target.origin !== live.origin) {
    return { ok: false, reason: `path "${req.path}" resolves outside the target origin` };
  }

  if (req.headers !== undefined && !isPlainObject(req.headers)) {
    return { ok: false, reason: "headers must be an object" };
  }

  const headers = {};
  for (const [rawName, value] of Object.entries(req.headers ?? {})) {
    const name = rawName.toLowerCase();
    if (typeof value !== "string") {
      return { ok: false, reason: `header "${rawName}" must be a string` };
    }
    if (name === "authorization") {
      // The two-mode rule. When --auth-env is configured, a page-supplied
      // Authorization is a second source of truth for one header — the
      // exact ambiguity this phase exists to remove — so it is refused,
      // not merged or overwritten. When no env token is configured, this
      // is the documented sessionStorage fallback and is forwarded as
      // typed.
      if (live.authEnv) {
        return { ok: false, reason: `Authorization is injected from ${live.authEnv} — remove it from the composer` };
      }
      headers.authorization = value;
      continue;
    }
    // A header outside the allowlist is a refusal that names the header,
    // not a silent drop. A silent drop makes COPY AS cURL print a command
    // that differs from what was actually sent — a small lie about the
    // tool's own behaviour — and a named refusal is debuggable where a
    // drop is not.
    if (!LIVE_HEADERS.includes(name)) {
      return { ok: false, reason: `header "${rawName}" is not forwardable` };
    }
    headers[name] = value;
  }

  const hasBody = req.body !== undefined && req.body !== null;
  if (hasBody && (method === "GET" || method === "HEAD")) {
    return { ok: false, reason: `${method} requests may not carry a body` };
  }
  if (hasBody && typeof req.body !== "string") {
    return { ok: false, reason: "body must be a string" };
  }
  if (hasBody && Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, reason: `body exceeds ${MAX_BODY_BYTES} bytes` };
  }

  return { ok: true, url: target.href, method, headers, body: hasBody ? req.body : undefined };
}

/* ══════════════════════ rate limiting ══════════════════════ */

/**
 * A token bucket, lazily refilled from a timestamp on each `take()` — no
 * timer, so nothing needs clearing on `server.close()`. One bucket per
 * server, not per client: there is exactly one client (the served page) and
 * `sameOrigin()` already establishes that. `now` is injectable so tests can
 * drive the clock without a real delay.
 *
 * @returns {{take(): boolean}}
 */
export function rateBucket({ capacity, perSec, now = Date.now }) {
  let tokens = capacity;
  let last = now();
  return {
    take() {
      const t = now();
      const elapsedSec = Math.max(0, t - last) / 1000;
      last = t;
      tokens = Math.min(capacity, tokens + elapsedSec * perSec);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/* ══════════════════════ logging ══════════════════════ */

/**
 * Freeze the server's live-mode config into the object `resolveOutbound`
 * and `liveInfo` read from. Built once in `bin`, from an already-validated
 * `resolveTarget()` origin — this does not re-run that validation itself
 * (`resolveOutbound` does, per request), so a caller that hands this an
 * unchecked origin gets a `live` object whose requests all refuse there
 * instead of being silently accepted here.
 */
export function makeLive({ origin, authEnv, token, timeoutMs, bucket } = {}) {
  return Object.freeze({
    origin,
    authEnv: authEnv ?? null,
    token: token ?? null,
    methods: LIVE_METHODS,
    headers: LIVE_HEADERS,
    maxBodyBytes: MAX_BODY_BYTES,
    timeoutMs: timeoutMs ?? LIVE_TIMEOUT_MS,
    // Always present, never optional. A live config without a rate limit is one
    // missing a security control, and defaulting it here means no caller can
    // forget to pass one. Injectable so a test can set the capacity it needs.
    bucket: bucket ?? rateBucket({}),
  });
}

/**
 * The payload's `live` field — token-free BY CONSTRUCTION. Built from an
 * explicit key whitelist, never by spreading `live`, so a field added to
 * `makeLive()` later (the token, or anything else) does not reach the page
 * merely by existing on the object.
 */
export function liveInfo(live) {
  if (!live) {
    return { offered: false, reason: "live mode is off — restart with --allow-live --target URL" };
  }
  return {
    offered: true,
    reason: null,
    target: live.origin,
    auth: live.authEnv ? "env" : "none",
    authEnv: live.authEnv ?? null,
    methods: live.methods,
    headers: live.headers,
    maxBodyBytes: live.maxBodyBytes,
    timeoutMs: live.timeoutMs,
  };
}

/**
 * Read a request body, refusing while reading rather than after.
 *
 * The cap is checked after every chunk, so at most `limit` plus one chunk is
 * ever resident. `content-length` is a hint and never a guarantee — a chunked
 * request carries none — so the running total is what decides.
 */
/**
 * Strip a query string out of anything on its way to the terminal.
 *
 * Applied to the whole assembled line rather than to one argument, because the
 * first version of this only cleaned the `path` parameter and a refusal reason
 * walked straight past it: `resolveOutbound` quotes the path it rejected, so
 * `path "http://evil.com/x?token=SECRET" resolves outside the target origin`
 * put the secret in the log in full. The reason still carries the whole path
 * back to the PAGE, where showing someone their own typing is the useful thing
 * to do; stderr is the boundary where it stops.
 */
const scrubQuery = (line) => String(line).replace(/\?[^\s"']*/g, "?…");

/**
 * The one line of stderr per proxied request, refusal or not.
 *
 * There is no headers parameter, and that is the design rather than an
 * omission: a token typed into a header has no argument here to arrive
 * through. Query strings are scrubbed from the finished line, which covers the
 * path, the refusal reason, and anything added later that forgets to.
 */
export function liveLogLine({ method, path, status, ms, bytes, error, refused }) {
  const p = String(path ?? "").split("?")[0];
  const line = refused ? `atlas live: ${method} ${p} refused: ${refused}`
    : error ? `atlas live: ${method} ${p} -> ${error} in ${ms}ms`
    : `atlas live: ${method} ${p} -> ${status} in ${ms}ms ${bytes}B`;
  return scrubQuery(line);
}


/* ══════════════════════ stats ══════════════════════ */

export async function readBody(req, limit = MAX_BODY_BYTES) {
  let n = 0;
  const chunks = [];
  for await (const chunk of req) {
    n += chunk.length;
    if (n > limit) return { ok: false, reason: `request body over ${limit} bytes` };
    chunks.push(chunk);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

/**
 * Send the one request, and report only what was observed about it.
 *
 * The return carries no response body and never will. Without that rule this
 * function would be a read primitive against everything the host can reach,
 * and with it the worst a page can learn is a status code and a duration. It
 * is also all the honesty contract lets the map draw: "the endpoint answered
 * 401 in 43 ms" is observed, and the response's contents are not something the
 * tool has any business rendering next to a modelled path.
 *
 * `redirect: "manual"` is a SECURITY control here, not a display choice. A
 * target inside the private ranges is free to redirect somewhere outside them,
 * and a followed redirect would launder every check in this file — as well as
 * attributing another origin's status to this endpoint.
 *
 * Errors collapse to a closed vocabulary. `e.message` is never surfaced:
 * Node's `fetch failed` carries the address it tried in its cause, and this
 * result is rendered in a browser and logged to a terminal.
 */
export async function forward(out, live) {
  const headers = { ...out.headers };
  // The only place the token is read, one line before it goes on the wire.
  if (live.token) headers.authorization = live.token;

  const started = performance.now();
  let r;
  try {
    r = await fetch(out.url, {
      method: out.method,
      headers,
      body: out.body,
      redirect: "manual",
      signal: AbortSignal.timeout(live.timeoutMs ?? LIVE_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      status: null,
      error: timedOut ? "timeout" : "unreachable",
      ms: Math.round(performance.now() - started),
    };
  }

  let bytes = 0;
  let truncated = false;
  try {
    for await (const chunk of r.body ?? []) {
      bytes += chunk.length;
      if (bytes >= MAX_RESPONSE_BYTES) {
        truncated = true;
        await r.body.cancel();
        break;
      }
    }
  } catch {
    // A body that dies mid-read still produced a status worth reporting.
    truncated = true;
  }

  return {
    status: r.status,
    statusText: r.statusText,
    // A redirect is reported, never followed, and the destination is not
    // handed to the page: knowing one happened is the honest part.
    redirected: r.status >= 300 && r.status < 400,
    ms: Math.round(performance.now() - started),
    bytes,
    truncated,
  };
}
