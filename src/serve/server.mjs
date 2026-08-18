/**
 * `atlas serve` — a loopback dev server for the viewer, plus a read-only
 * source endpoint that exists only in this mode.
 *
 * `build` writes the viewer once, self-contained. `serve` re-concatenates the
 * same `src/viewer/*.js` modules per request via `assemble()` — the only
 * legitimate second caller of that assembly, never a duplicate of it.
 *
 * Everything else here defends a server a browser can reach: `listen()` binds
 * `127.0.0.1` as a literal, not a parameter, so it can never become a flag.
 * `Host` pinning and `Sec-Fetch-Site` rejection are DNS-rebinding defenses —
 * the specific attack against a server that only checks its bind address.
 * The source endpoint is set-membership-allowlisted (`resolveAllowed`, below),
 * `lstat`-refuses symlinks, caps size, and always answers `text/plain` so
 * nothing read from the repo is ever interpreted as markup.
 */
import { createServer } from "node:http";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { collect } from "../scan/walk.mjs";
import { assemble } from "../build/assemble.mjs";

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

/**
 * DNS rebinding lets a page whose origin the browser trusts as "localhost"
 * make the browser send a request that actually lands here from an attacker's
 * page, once the DNS answer for their hostname is repointed to 127.0.0.1.
 * `Host` pinning defeats that: the header still names the attacker's host,
 * not this server's. `Sec-Fetch-Site` is the second, independent check —
 * absent on old browsers, but a real cross-site value is refused when present.
 */
function sameOrigin(req, host) {
  // Host pinning is the actual rebinding defense: the attacker's page reaches
  // this port under THEIR hostname, so the header names them and not us.
  if (req.headers.host !== host) return false;

  const site = req.headers["sec-fetch-site"];
  if (!site || site === "same-origin" || site === "none") return true;

  // A cross-site *fetch* is the thing worth refusing — a page on another origin
  // reading this one's responses. A cross-site top-level navigation is not: it
  // is a person following a link, the response is rendered rather than read,
  // and refusing it means typing this server's own URL from any other page
  // yields a bare 403. Host pinning still governs both.
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

function makeHandler({ repoDir, html, allow, hostOf }) {
  return (req, res) => {
    // Origin-form only. A proxy may legitimately send an absolute request
    // target (`GET http://host/path`), but then `new URL()` takes its authority
    // from the request line while `sameOrigin` reasons about the Host header —
    // two sources of truth for one question. Nothing that should reach a
    // loopback dev server needs the other form, so refuse it outright.
    if (!req.url?.startsWith("/")) return send(res, 400, "bad request");

    if (!sameOrigin(req, hostOf())) {
      // The host is pinned to the exact bound address, so `localhost:PORT`
      // is refused as surely as an attacker's hostname. Say so, or the first
      // person who types it sees a bare 403 and assumes the server is broken.
      return send(res, 403, `forbidden — this server answers only to ${hostOf()}\n`);
    }

    const url = new URL(req.url, "http://atlas.invalid");
    if (url.pathname === "/api/source") return handleSource(req, res, url, repoDir, allow);

    if (url.pathname === "/") {
      if (req.method !== "GET") return send(res, 405, "method not allowed");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    return send(res, 404, "not found");
  };
}

/**
 * Serve `payload`'s viewer, plus source reads from `repo` scoped to
 * `collect(repo, {keep, exclude})`'s own file set — the same filter the scan
 * that produced `payload` applied, so the allowlist and the map agree.
 *
 * The bind host is a literal below: `listen(port, opts)` takes no host
 * argument, so there is nothing a caller could pass to change it.
 */
export function listen(port, { repo, keep, exclude, payload }) {
  const { fileSet } = collect(repo, { keep, exclude });
  const html = assemble(payload);

  let host = null; // resolved once the actual bound port is known
  const server = createServer(makeHandler({ repoDir: repo, html, allow: fileSet, hostOf: () => host }));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      host = `127.0.0.1:${server.address().port}`;
      resolve(server);
    });
  });
}

/* ════════════════════ the source-read allowlist ════════════════════
 *
 * Path traversal is defended by **set membership**, not by sanitising the
 * requested string. The scan already produced the exact set of files it kept
 * (`fileSet`, from `collect()` in `src/scan/walk.mjs`) — a request for anything
 * outside that set is not a string to clean up, it is simply not a key in the
 * set, so `..`, an absolute path, or a URL-encoded traversal all fail the same
 * way: `allow.has(rel)` is false.
 *
 * On top of membership: the resolved path is re-checked against the repo root,
 * and `lstatSync` (never `stat`) refuses anything that is — or has become — a
 * symlink, so a file swapped for a symlink after the scan ran is refused at
 * request time. `collect()`'s own walk already excludes symlinks from
 * `fileSet` in the first place; this is the second, independent layer.
 *
 * The one window it does not close is between the `lstat` and the read, which
 * would need an `open`/`fstat` pair to shut properly. Naming it rather than
 * implying it is closed: exploiting it needs write access to the repository
 * being served, and anyone holding that already owns the files this endpoint
 * would hand back.
 */
/** A source file, not an asset — large enough for any real file, small enough to cap abuse. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * @returns the absolute path to read, or null if the request must be refused.
 */
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
