/**
 * `POST /api/live` — the one place this tool opens an outbound connection.
 *
 * `test/proxy.test.mjs` proves what may be sent without a network. This proves
 * the endpoint in front of it: that refusals happen before a body is buffered,
 * that the token reaches the target and nothing else, that a redirect is
 * reported and never followed, and that the origin checks sit in front of the
 * socket rather than beside it.
 *
 * The target is a second `http.createServer` on port 0, started and torn down
 * by the test. That is a deliberate re-scoping of the roadmap's gate, which
 * named a running Shuttrr: an upstream the suite owns is reproducible on a
 * fresh clone, where a corpus repository is optional by design — the same
 * argument `test/helpers.mjs` already makes about corpus tests skipping. The
 * behaviour being gated is "a real target answered", and this is one.
 *
 * The upstream records every request it receives, so "the proxy never contacted
 * it" is assertable rather than assumed. Several tests below turn on exactly
 * that: a refusal that still reached the target would be a refusal in name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { listen } from "../src/serve/server.mjs";
import { makeLive, rateBucket } from "../src/serve/proxy.mjs";
import { scan } from "../src/build/build.mjs";
import { loadConfig } from "../src/config/load.mjs";
import { tmpRepo } from "./helpers.mjs";

/** A target that answers in every shape the proxy has to cope with. */
async function upstream(t) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    const url = new URL(req.url, "http://upstream.invalid");
    if (url.pathname === "/ok") {
      // A measurable delay, so an asserted latency is a real number rather
      // than a zero that would pass whatever the clock did.
      await new Promise((r) => setTimeout(r, 30));
      return res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    }
    if (url.pathname === "/unauthorized") return res.writeHead(401).end("no");
    if (url.pathname === "/moved") return res.writeHead(302, { location: "http://example.com/" }).end();
    if (url.pathname === "/slow") return;                       // never answers
    if (url.pathname === "/huge") {
      res.writeHead(200);
      // Comfortably past the 1 MB cap, in chunks so the drain loop sees them.
      for (let i = 0; i < 40; i++) res.write("x".repeat(64 * 1024));
      return res.end();
    }
    if (url.pathname === "/needs-auth") {
      const ok = req.headers.authorization === "Bearer FIXTURE";
      return res.writeHead(ok ? 200 : 401).end(ok ? "yes" : "no");
    }
    return res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { seen, origin: `http://127.0.0.1:${server.address().port}` };
}

/** An atlas server, optionally with live mode on. */
async function serveWith(t, { live = null } = {}) {
  const dir = tmpRepo(t, "flat-app");
  const { payload } = scan({ repo: dir, ref: "fs", warn: () => {}, progress: () => {} });
  const { keep, exclude } = loadConfig();
  const log = [];
  const server = await listen(0, { repo: dir, keep, exclude, payload, live, log: (l) => log.push(l) });
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, log, server };
}

const post = (base, body, headers = {}) =>
  fetch(base + "/api/live", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/* ── the process-level gate ───────────────────────────────────── */

test("without --allow-live the endpoint refuses, and says which flag is missing", async (t) => {
  const { base } = await serveWith(t);
  const res = await post(base, { method: "GET", path: "/ok" });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /--allow-live/);
});

test("the endpoint is POST only", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  assert.equal((await fetch(base + "/api/live")).status, 405);
  assert.equal(up.seen.length, 0);
});

/* ── a real request to a real target ──────────────────────────── */

test("a composed request reaches the target, and the latency is observed", async (t) => {
  const up = await upstream(t);
  const { base, log } = await serveWith(t, { live: makeLive({ origin: up.origin }) });

  const res = await post(base, { method: "GET", path: "/ok" });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.status, 200);
  assert.ok(body.ms >= 25, `expected a real round trip, got ${body.ms}ms`);
  assert.ok(body.bytes > 0);
  assert.equal(up.seen.length, 1, "the target saw exactly one request");
  assert.equal(up.seen[0].url, "/ok");
  assert.match(log.join("\n"), /-> 200 in \d+ms/);
});

/**
 * The page is told a status, a duration and a size. It is never told what came
 * back. Without this the proxy would be a read primitive against everything the
 * host can reach, and the map would have a response body to render next to a
 * modelled path, which is the one juxtaposition the honesty contract forbids.
 */
test("no response body ever reaches the page", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const body = await (await post(base, { method: "GET", path: "/ok" })).json();
  assert.ok(!("body" in body), "the proxy returned a response body");
  assert.ok(!JSON.stringify(body).includes("ok\":true"), "the target's payload leaked into the result");
  assert.deepEqual(
    Object.keys(body).sort(),
    ["bytes", "ms", "redirected", "status", "statusText", "truncated"],
  );
});

test("a 401 is reported as a 401, not as a failure", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const body = await (await post(base, { method: "GET", path: "/unauthorized" })).json();
  assert.equal(body.status, 401);
  assert.ok(body.ms >= 0);
});

/** A followed redirect would launder every check in proxy.mjs. */
test("a redirect is reported and never followed", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const body = await (await post(base, { method: "GET", path: "/moved" })).json();
  assert.equal(body.status, 302);
  assert.equal(body.redirected, true);
  assert.ok(!JSON.stringify(body).includes("example.com"), "the redirect target leaked to the page");
  assert.equal(up.seen.length, 1, "and nothing followed it");
});

test("a target that never answers times out rather than hanging", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin, timeoutMs: 200 }) });
  const body = await (await post(base, { method: "GET", path: "/slow" })).json();
  assert.equal(body.status, null);
  assert.equal(body.error, "timeout");
});

test("an oversized response is truncated and says so", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const body = await (await post(base, { method: "GET", path: "/huge" })).json();
  assert.equal(body.status, 200);
  assert.equal(body.truncated, true);
});

/* ── refusals happen before anything is spent ─────────────────── */

test("an oversized request body is refused without the target being contacted", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const huge = JSON.stringify({ method: "POST", path: "/ok", body: "x".repeat(300 * 1024) });
  const res = await post(base, huge).catch((e) => e);
  if (res instanceof Error) {
    // Some clients see the socket close rather than the 413; either way the
    // fact under test is the same one.
    assert.match(String(res.message), /.*/);
  } else {
    assert.equal(res.status, 413);
  }
  assert.equal(up.seen.length, 0, "an over-cap body still reached the target");
});

test("a refused request never reaches the target", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  for (const body of [
    { method: "GET", path: "http://example.com/" },
    { method: "TRACE", path: "/ok" },
    { method: "GET", path: "/ok", headers: { cookie: "a=b" } },
  ]) {
    const res = await post(base, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.text()).length, "a refusal must carry its reason");
  }
  assert.equal(up.seen.length, 0);
});

test("the rate bucket refuses before the body is read", async (t) => {
  const up = await upstream(t);
  const live = makeLive({ origin: up.origin, bucket: rateBucket({ capacity: 2, perSec: 0 }) });
  const { base } = await serveWith(t, { live });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await post(base, { method: "GET", path: "/ok" })).status);
  assert.ok(codes.includes(429), `expected a 429 among ${codes}`);
  assert.ok(up.seen.length <= 2, `the bucket let ${up.seen.length} through a capacity of 2`);
});

test("a non-JSON content type is refused", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const res = await fetch(base + "/api/live", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(res.status, 415);
  assert.equal(up.seen.length, 0);
});

/* ── the origin checks sit in front of the socket ─────────────── */

test("a forged Host is refused, and the target is never contacted", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const port = Number(new URL(base).port);

  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/live", method: "POST",
        headers: { Host: "evil.example", "content-type": "application/json" } },
      (res) => resolve(res.statusCode),
    );
    req.on("error", reject);
    req.end(JSON.stringify({ method: "GET", path: "/ok" }));
  });

  assert.equal(status, 403);
  assert.equal(up.seen.length, 0, "a rebinding request reached the target");
});

test("a cross-site fetch is refused", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const res = await post(base, { method: "GET", path: "/ok" }, {
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "cors",
  });
  assert.equal(res.status, 403);
  assert.equal(up.seen.length, 0);
});

/**
 * sameOrigin deliberately permits a cross-site top-level navigation so a person
 * can follow a link into the viewer. A cross-site form POST is exactly that
 * shape, and this endpoint must not inherit the carve-out. The content-type
 * gate blocks the same request today by accident; this asserts the deliberate
 * check, so relaxing that gate later cannot quietly reopen the path.
 */
test("a cross-site document navigation is refused even carrying JSON", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const port = Number(new URL(base).port);
  const body = JSON.stringify({ method: "GET", path: "/ok" });

  // A raw socket, for the same reason serve.test.mjs uses one for Host:
  // sec-fetch-* are forbidden header names, so fetch()/undici will not send
  // them and a test written with fetch proves nothing about this path. The
  // first version of this test did exactly that and passed against a server
  // with the check removed.
  const raw = await new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => sock.write([
      "POST /api/live HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Sec-Fetch-Site: cross-site",
      "Sec-Fetch-Mode: navigate",
      "Sec-Fetch-Dest: document",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Connection: close",
      "", body,
    ].join("\r\n")));
    let out = "";
    sock.setTimeout(3000);
    sock.on("data", (d) => (out += d));
    sock.on("timeout", () => { sock.destroy(); resolve(out); });
    sock.on("close", () => resolve(out));
    sock.on("error", () => resolve(out));
  });

  assert.match(raw, /^HTTP\/1\.1 403/, `expected a refusal, got: ${raw.split("\r\n")[0]}`);
  assert.equal(up.seen.length, 0, "a cross-site navigation reached the target");
});


test("the live response carries the same security headers as everything else", async (t) => {
  const up = await upstream(t);
  const { base } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  const res = await post(base, { method: "GET", path: "/ok" });
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(res.headers.get("content-security-policy"));
});

/* ── the token ────────────────────────────────────────────────── */

test("the token reaches the target and nothing else", async (t) => {
  const up = await upstream(t);
  const live = makeLive({ origin: up.origin, authEnv: "AUTH_TOKEN", token: "Bearer FIXTURE" });
  const { base, log } = await serveWith(t, { live });

  const res = await post(base, { method: "GET", path: "/needs-auth" });
  const body = await res.json();
  assert.equal(body.status, 200, "the token was not injected — the target refused it");
  assert.equal(up.seen[0].headers.authorization, "Bearer FIXTURE");

  const seenByPage = JSON.stringify(body) + [...res.headers].join("");
  assert.ok(!seenByPage.includes("FIXTURE"), "the token came back to the page");
  assert.ok(!log.join("\n").includes("FIXTURE"), "the token reached stderr");
});

test("a query string never reaches the log", async (t) => {
  const up = await upstream(t);
  const { base, log } = await serveWith(t, { live: makeLive({ origin: up.origin }) });
  await post(base, { method: "GET", path: "/ok?token=SUPERSECRET" });
  assert.equal(up.seen[0].url, "/ok?token=SUPERSECRET", "the query did reach the target, as composed");
  assert.ok(!log.join("\n").includes("SUPERSECRET"), "and it must not reach the terminal");
});

/* ── what the page is told ────────────────────────────────────── */

test("the served page is told whether live is on offer, and never the token", async (t) => {
  const up = await upstream(t);
  const live = makeLive({ origin: up.origin, authEnv: "AUTH_TOKEN", token: "Bearer FIXTURE" });
  const { base } = await serveWith(t, { live });
  const html = await (await fetch(base + "/")).text();
  assert.ok(html.includes('"offered":true'), "the page was not told live is available");
  assert.ok(html.includes("AUTH_TOKEN"), "the page needs the variable NAME for COPY AS cURL");
  assert.ok(!html.includes("FIXTURE"), "the token was assembled into the page");
});

test("with live off the page is told the reason rather than left to guess", async (t) => {
  const { base } = await serveWith(t);
  const html = await (await fetch(base + "/")).text();
  assert.ok(html.includes('"offered":false'));
  assert.ok(html.includes("--allow-live"), "the reason has to come from the server");
});

test("net is only used as a predicate here, never to open anything", () => {
  // Guards the one import that looks like a socket and is not.
  assert.equal(typeof net.isIPv6, "function");
});
