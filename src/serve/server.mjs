/** `atlas serve` — a loopback dev server for the viewer plus a read-only source endpoint. Defenses: `127.0.0.1` bound as a literal so it can never become a flag, `Host` pinning and `Sec-Fetch-Site` against DNS rebinding, and a set-membership allowlist that `lstat`-refuses symlinks, caps size, and always answers `text/plain`. */
import { createServer } from "node:http";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { collect } from "../scan/walk.mjs";
import { assemble } from "../build/assemble.mjs";
import { readBody, forward, resolveOutbound, liveInfo, liveLogLine, MAX_BODY_BYTES } from "./proxy.mjs";

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", CSP);
}

/** The rebinding defense: an attacker's page repointed to 127.0.0.1 still sends THEIR hostname in `Host`, so pinning it refuses them; `Sec-Fetch-Site` is a second, independent check. */
function sameOrigin(req, host) {
  if (req.headers.host !== host) return false;

  const site = req.headers["sec-fetch-site"];
  if (!site || site === "same-origin" || site === "none") return true;

  // A cross-site *fetch* is what is worth refusing; a cross-site top-level navigation is a person following a link, and Host pinning still governs both.
  return req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document";
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  securityHeaders(res);
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function handleSource(req, res, url, repoDir, allow) {
  if (req.method !== "GET") return send(res, 405, "method not allowed");
  const rel = url.searchParams.get("path");
  const full = resolveAllowed(repoDir, allow, rel);
  if (!full) return send(res, 404, "not found");
  let body;
  try {
    body = readFileSync(full, "utf8");
  } catch {
    return send(res, 404, "not found");
  }
  send(res, 200, body);
}

/** `POST /api/live` — forward one composed request to the target. The order is load-bearing: every cheap refusal happens before a body is buffered, so a request that was never going to be sent cannot cost 256 KB first. 403 is the process-level gate, 400 the request itself. */
async function handleLive(req, res, live, log) {
  const refuse = (status, reason, fields = {}) => {
    log(liveLogLine({ method: fields.method ?? req.method, path: fields.path ?? "/api/live", refused: reason }));
    return send(res, status, reason + "\n");
  };

  if (req.method !== "POST") return send(res, 405, "method not allowed");
  // sameOrigin lets a cross-site top-level navigation through; a proxied request is never one, so that carve-out is closed here explicitly rather than left to the content-type gate below.
  if (req.headers["sec-fetch-dest"] === "document") {
    return refuse(403, "this endpoint does not answer document navigations");
  }
  if (!live) {
    return refuse(403, "live mode is off — restart atlas serve with --allow-live and --target URL");
  }
  // Before the body read: a rate-limited request must not cost a buffer either.
  if (!live.bucket.take()) return refuse(429, "too many live requests");
  const type = String(req.headers["content-type"] ?? "");
  if (!type.startsWith("application/json")) {
    return refuse(415, "expected application/json");
  }

  const body = await readBody(req, MAX_BODY_BYTES);
  if (!body.ok) {
    // Respond first, then destroy: destroying first kills the response with it, and the page would see a hang-up instead of the reason.
    const out = refuse(413, body.reason);
    req.destroy();
    return out;
  }

  let parsed;
  try { parsed = JSON.parse(body.text); } catch { return refuse(400, "body must be JSON"); }

  const out = resolveOutbound(live, parsed);
  if (!out.ok) return refuse(400, out.reason, { method: parsed?.method, path: parsed?.path });

  const result = await forward(out, live);
  const where = new URL(out.url);
  log(liveLogLine({
    method: out.method,
    // Pathname only, the outer of two independent layers: liveLogLine strips a query string again on its own side.
    path: where.pathname,
    status: result.status,
    ms: result.ms,
    bytes: result.bytes,
    error: result.error,
  }));
  return send(res, 200, JSON.stringify(result), "application/json; charset=utf-8");
}

function makeHandler({ repoDir, html, allow, hostOf, live = null, log = () => {} }) {
  return (req, res) => {
    // Origin-form only: an absolute request target would give `new URL()` an authority from the request line while `sameOrigin` reasons about `Host`, two sources of truth for one question.
    if (!req.url?.startsWith("/")) return send(res, 400, "bad request");

    if (!sameOrigin(req, hostOf())) {
      // The host is pinned to the exact bound address, so `localhost:PORT` is refused too — say so, or it reads as a broken server.
      return send(res, 403, `forbidden — this server answers only to ${hostOf()}\n`);
    }

    const url = new URL(req.url, "http://atlas.invalid");
    if (url.pathname === "/api/source") return handleSource(req, res, url, repoDir, allow);
    if (url.pathname === "/api/live") return handleLive(req, res, live, log);

    if (url.pathname === "/") {
      if (req.method !== "GET") return send(res, 405, "method not allowed");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    return send(res, 404, "not found");
  };
}

/** Serve `payload`'s viewer plus source reads scoped to `collect()`'s own file set, so the allowlist and the map agree. The bind host is a literal below, with no argument a caller could pass to change it. */
export function listen(port, { repo, keep, exclude, payload, live = null, log = () => {} }) {
  const { fileSet } = collect(repo, { keep, exclude });
  // Live config is injected into the viewer's payload only, never the one `scan()` produced, so `--json` stays a pure function of the repository.
  const html = assemble({ ...payload, live: liveInfo(live) });

  let host = null; // resolved once the actual bound port is known
  const server = createServer(makeHandler({ repoDir: repo, html, allow: fileSet, hostOf: () => host, live, log }));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      host = `127.0.0.1:${server.address().port}`;
      resolve(server);
    });
  });
}

/* ══ the source-read allowlist: traversal is defended by set membership (`allow.has(rel)`), never by sanitising the string, so `..`, an absolute path and an encoded traversal all fail identically; `lstatSync` (never `stat`) is the second layer, refusing a file swapped for a symlink after the scan. The lstat-to-read window stays open, and closing it needs write access to the repo being served. ══ */
/** A source file, not an asset — large enough for any real file, small enough to cap abuse. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** @returns the absolute path to read, or null if the request must be refused. */
export function resolveAllowed(repoDir, allow, rel) {
  if (typeof rel !== "string" || !allow.has(rel)) return null;

  const full = path.resolve(repoDir, rel);
  const root = path.resolve(repoDir);
  if (full !== path.join(root, rel)) return null;
  if (full !== root && !full.startsWith(root + path.sep)) return null;

  let st;
  try {
    st = lstatSync(full);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;

  return full;
}
