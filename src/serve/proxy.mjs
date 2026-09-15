/** The live-proxy security core: pure decisions about what the composer may send and where, each refusal carrying a reason for the UI. Never compute per-hop timing here — a modelled hop must not read as an observed one. */
import net from "node:net";

/** Methods this proxy will ever forward. Same seven verbs as endpoints.mjs, different meaning; kept in sync by hand rather than coupled by import. */
export const LIVE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Headers the page composer may set directly. `authorization` is absent (two-mode rule in `resolveOutbound`) and `user-agent` is absent (always set server-side, so upstream sees who is really asking). */
export const LIVE_HEADERS = ["accept", "accept-language", "content-type", "if-match", "if-none-match", "x-request-id", "x-requested-with"];

/** Composer request body cap. Enforced here on the parsed value, and again while streaming the raw body in `readBody()`. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Upstream response cap, enforced by `forward()` while reading. */
const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Per-request upstream timeout, enforced by `forward()`. */
const LIVE_TIMEOUT_MS = 10_000;

/** Default token-bucket size. A live config must never end up without a rate limit. */
const LIVE_RATE_CAPACITY = 60;
/** Default refill rate, in requests per second. */
const LIVE_RATE_PER_SEC = 10;

/* ══ the loopback/private-host check: purely syntactic on the typed hostname, no DNS resolution ever — rebinding threat model and residuals in PLAN.md, "### `atlas serve`" ══ */

function parseIPv4(hostname) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Numeric-octet classification, shared with the IPv4 tail of an IPv6 literal. Compares parsed integers, never strings: a `startsWith("172.")` would wrongly admit 172.15 and 172.32. */
function isPrivateIPv4Octets([a, b]) {
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false; // includes 169.254/16 and 0.0.0.0/8's other members — see isPrivateHost
}

/** Expand an IPv6 literal (no brackets, as `URL#hostname` gives it) to eight 16-bit groups, or null; handles `::` compression and an embedded IPv4 tail. */
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

/** @returns whether `hostname` is a loopback or private-network host this proxy may target, decided syntactically — see the banner above. */
export function isPrivateHost(hostname) {
  if (typeof hostname !== "string" || hostname === "") return false;
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const v4 = parseIPv4(host);
  if (v4) {
    const [a, b] = v4;
    // 169.254.0.0/16 is link-local and hosts cloud metadata (169.254.169.254): refused by name, never left to fall through the RFC1918 ranges below.
    if (a === 169 && b === 254) return false;
    if (a === 0) return false; // 0.0.0.0 is a bind address, not a destination
    return isPrivateIPv4Octets(v4);
  }

  const v6 = expandIPv6(host);
  if (v6) {
    if (v6.every((g) => g === 0)) return false; // :: — the v6 analogue of 0.0.0.0
    if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return true; // ::1 — loopback
    if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
      // ::ffff:a.b.c.d — classify the embedded IPv4 by the same numeric rule, 169.254 carve-out included.
      const a = v6[6] >> 8, b = v6[6] & 0xff;
      if (a === 169 && b === 254) return false;
      if (a === 0) return false;
      return isPrivateIPv4Octets([a, b]);
    }
    // fe80::/10 — link-local, the v6 sibling of 169.254/16 that metadata services also answer on.
    if (v6[0] >= 0xfe80 && v6[0] <= 0xfebf) return false;
    // fc00::/7 — unique local addresses: private-shaped, but not on this syntactic allowlist.
    if (v6[0] >= 0xfc00 && v6[0] <= 0xfdff) return false;
    return false;
  }

  return false; // any other string is a hostname atlas will not resolve
}

/* ══════════════════════ what --target may name ══════════════════════ */

// Requires "://" so a bare `host:port` (`localhost:3000`) is never mistaken for a scheme.
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/** Validate a `--target` spec (bare `host[:port]`, or a full origin) into an origin. @returns {{ok:true,origin:string}|{ok:false,reason:string}} */
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

  // Credentials in the URL would become an Authorization header the log line never sees.
  if (url.username || url.password) {
    return { ok: false, reason: "credentials in the target are refused — they would become an Authorization header the log line never sees" };
  }

  // A target is an origin, not a path: a second source of route prefix alongside the composer's own `path`.
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { ok: false, reason: `a target is an origin, not a path — remove "${url.pathname}${url.search}${url.hash}"` };
  }

  if (!isPrivateHost(unbracket(url.hostname))) {
    return { ok: false, reason: `"${url.hostname}" is not a loopback or private-network host — atlas does not resolve DNS, so type the IP directly` };
  }

  return { ok: true, origin: url.origin };
}

/* ══════════════════════ what the page composer may send ══════════════════════ */

// `URL#hostname` keeps IPv6 brackets (`"[::1]"`); isPrivateHost takes the bare form, so callers strip here.
function unbracket(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The pure decision behind `POST /api/live`: build the exact request `forward()` will make, or refuse with a reason. Never reads `live.token`, so no return value can carry the env-injected secret. */
export function resolveOutbound(live, req) {
  if (!live || typeof live.origin !== "string") {
    return { ok: false, reason: "live mode is off" };
  }

  // Re-asserted per request, socket-free, so "refuses a non-loopback target" is testable without a server.
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
  // Refused by name, though fetch would also reject: credentials become an Authorization the log line never sees.
  if (target.username || target.password) {
    return { ok: false, reason: "a path must not carry credentials" };
  }
  // The origin check is the defense, not path purity: dot-segments inside the origin are harmless, while `//example.com/x` and `/\/example.com` (normalized to `//`) replace the host and are caught here.
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
      // The two-mode rule: with --auth-env set, a page-supplied Authorization is a second source of truth for one header and is refused; without it, this is the documented sessionStorage fallback.
      if (live.authEnv) {
        return { ok: false, reason: `Authorization is injected from ${live.authEnv} — remove it from the composer` };
      }
      headers.authorization = value;
      continue;
    }
    // A header outside the allowlist is refused by name, never dropped silently: a drop would make COPY AS cURL print a command that differs from what was sent.
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

/** A token bucket, lazily refilled on each `take()` so no timer needs clearing. One bucket per server; `now` is injectable so tests can drive the clock. @returns {{take(): boolean}} */
export function rateBucket({ capacity = LIVE_RATE_CAPACITY, perSec = LIVE_RATE_PER_SEC, now = Date.now } = {}) {
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

/** Freeze the server's live-mode config. Takes an already-validated `resolveTarget()` origin and does not re-check it; `resolveOutbound` does, per request. */
export function makeLive({ origin, authEnv, token, timeoutMs, bucket } = {}) {
  return Object.freeze({
    origin,
    authEnv: authEnv ?? null,
    token: token ?? null,
    methods: LIVE_METHODS,
    headers: LIVE_HEADERS,
    maxBodyBytes: MAX_BODY_BYTES,
    timeoutMs: timeoutMs ?? LIVE_TIMEOUT_MS,
    // Always present, never optional: a live config without a rate limit is missing a security control. Injectable for tests.
    bucket: bucket ?? rateBucket({}),
  });
}

/** The payload's `live` field — token-free by construction: an explicit key whitelist, never a spread of `live`, so a field added to `makeLive()` later cannot reach the page by existing. */
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

/** Strip query strings out of anything on its way to the terminal, applied to the whole assembled line because a refusal reason quotes the path it rejected. */
const scrubQuery = (line) => String(line).replace(/\?[^\s"']*/g, "?…");

/** The one line of stderr per proxied request. No headers parameter by design: a token typed into a header has no argument here to arrive through. */
export function liveLogLine({ method, path, status, ms, bytes, error, refused }) {
  const p = String(path ?? "").split("?")[0];
  const line = refused ? `atlas live: ${method} ${p} refused: ${refused}`
    : error ? `atlas live: ${method} ${p} -> ${error} in ${ms}ms`
    : `atlas live: ${method} ${p} -> ${status} in ${ms}ms ${bytes}B`;
  return scrubQuery(line);
}

/** Read a request body, refusing while reading: the cap is checked after every chunk, since `content-length` is a hint a chunked request does not even carry. */
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

/** Send the one request and report only what was observed — status, duration, bytes, never a response body, which would make this a read primitive against everything the host can reach. `redirect:"manual"` is a security control: a followed 302 to 169.254.169.254 would launder every check in this file. Errors collapse to a closed vocabulary so Node's `fetch failed` cause never surfaces. */
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
    // A redirect is reported, never followed, and the destination is not handed to the page.
    redirected: r.status >= 300 && r.status < 400,
    ms: Math.round(performance.now() - started),
    bytes,
    truncated,
  };
}
