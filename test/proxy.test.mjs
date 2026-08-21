/**
 * `src/serve/proxy.mjs` — Part A, socket-free. No fixture upstream here and
 * no `forward()`/`readBody()` call: those open a real socket and land in a
 * later commit, alongside their own tests (Part B). This file is the entire
 * refusal matrix for the live proxy, provable before anything in the
 * codebase can reach a network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPrivateHost,
  resolveTarget,
  resolveOutbound,
  rateBucket,
  liveLogLine,
  liveStats,
  makeLive,
  liveInfo,
  LIVE_METHODS,
  LIVE_HEADERS,
} from "../src/serve/proxy.mjs";

const live = makeLive({ origin: "http://127.0.0.1:3000", authEnv: null, token: null });
const liveWithEnv = makeLive({ origin: "http://127.0.0.1:3000", authEnv: "ATLAS_TOKEN", token: "SECRET-ENV-TOKEN" });

/* ════════════════════ resolveOutbound: the refusal matrix ════════════════════ */

test("resolveOutbound allows a plain path and every allowed case stays on the target origin", () => {
  const cases = [
    { method: "GET", path: "/ok" },
    { method: "get", path: "/ok" }, // lowercase method is allowed
    { method: "POST", path: "/x", headers: { "content-type": "application/json" }, body: "{}" },
    { method: "GET", path: "x/y" }, // relative, no leading slash — resolves under the origin's root
    { method: "GET", path: "/a/../../etc" }, // dot-segments that never leave the origin
  ];
  for (const c of cases) {
    const out = resolveOutbound(live, c);
    assert.equal(out.ok, true, `expected allow for ${JSON.stringify(c)}: ${out.reason}`);
    // The origin assertion is the actual defense — re-run on every allowed
    // case so a future change cannot quietly widen it.
    assert.equal(new URL(out.url).origin, live.origin);
  }
});

test("/a/../../etc resolves to origin + /etc — path purity is not the defense, the origin check is", () => {
  const out = resolveOutbound(live, { method: "GET", path: "/a/../../etc" });
  assert.equal(out.ok, true);
  assert.equal(out.url, live.origin + "/etc");
});

test("an absolute or protocol-relative path that would change the origin is refused", () => {
  const cases = [
    "http://example.com/",
    "https://example.com/",
    "//example.com/x",
    // WHATWG URL parsing normalizes a leading backslash to `/` for special
    // schemes, so this becomes `//example.com` — a network-path reference
    // that replaces the host. The origin check catches it without any
    // string-level backslash detection.
    "/\\/example.com",
  ];
  for (const path of cases) {
    const out = resolveOutbound(live, { method: "GET", path });
    assert.equal(out.ok, false, `expected refusal for path ${JSON.stringify(path)}`);
  }
});

test("control characters in the path are stripped by URL parsing and stay within the origin", () => {
  // WHATWG URL parsing strips TAB/CR/LF from the input before parsing, so
  // none of these are a bypass — they are asserted allowed and on-origin,
  // not refused, so nobody "fixes" this into a refusal later.
  for (const path of ["/x\ty", "\n", "\r", "/a\r\nb"]) {
    const out = resolveOutbound(live, { method: "GET", path });
    assert.equal(out.ok, true, `expected allow for path ${JSON.stringify(path)}`);
    assert.equal(new URL(out.url).origin, live.origin);
  }
});

test("non-string paths are refused", () => {
  for (const path of [42, null, undefined, ["/x"], { path: "/x" }]) {
    const out = resolveOutbound(live, { method: "GET", path });
    assert.equal(out.ok, false, `expected refusal for path ${JSON.stringify(path)}`);
  }
});

test("methods outside LIVE_METHODS are refused; TRACE and CONNECT included", () => {
  for (const method of ["TRACE", "CONNECT", "PURGE", "", 7, null]) {
    const out = resolveOutbound(live, { method, path: "/x" });
    assert.equal(out.ok, false, `expected refusal for method ${JSON.stringify(method)}`);
  }
});

test("every LIVE_METHODS entry is accepted, uppercase or lowercase", () => {
  for (const method of [...LIVE_METHODS]) {
    assert.equal(resolveOutbound(live, { method, path: "/x" }).ok, true, method);
    assert.equal(resolveOutbound(live, { method: method.toLowerCase(), path: "/x" }).ok, true, method.toLowerCase());
  }
});

test("a header outside the allowlist is refused BY NAME, not silently dropped", () => {
  for (const header of ["Cookie", "Host", "X-Forwarded-For", "connection", "upgrade", "transfer-encoding", "content-length", "user-agent"]) {
    const out = resolveOutbound(live, { method: "GET", path: "/x", headers: { [header]: "x" } });
    assert.equal(out.ok, false, `expected refusal for header ${header}`);
    assert.match(out.reason, new RegExp(header, "i"), "refusal reason must name the header");
  }
});

test("every LIVE_HEADERS entry is forwarded", () => {
  for (const header of LIVE_HEADERS) {
    const out = resolveOutbound(live, { method: "GET", path: "/x", headers: { [header]: "v" } });
    assert.equal(out.ok, true, header);
    assert.equal(out.headers[header], "v");
  }
});

test("Authorization: authEnv set + page sends it -> refused, names the env var", () => {
  const out = resolveOutbound(liveWithEnv, { method: "GET", path: "/x", headers: { Authorization: "Bearer nope" } });
  assert.equal(out.ok, false);
  assert.match(out.reason, /ATLAS_TOKEN/);
});

test("Authorization: authEnv set + page sends nothing -> resolveOutbound carries no authorization header (forward() injects it)", () => {
  const out = resolveOutbound(liveWithEnv, { method: "GET", path: "/x" });
  assert.equal(out.ok, true);
  assert.ok(!("authorization" in out.headers));
});

test("Authorization: authEnv unset + page sends it -> forwarded as typed (the sessionStorage fallback)", () => {
  const out = resolveOutbound(live, { method: "GET", path: "/x", headers: { Authorization: "Bearer mine" } });
  assert.equal(out.ok, true);
  assert.equal(out.headers.authorization, "Bearer mine");
});

test("Authorization: authEnv unset + page sends nothing -> nothing sent", () => {
  const out = resolveOutbound(live, { method: "GET", path: "/x" });
  assert.equal(out.ok, true);
  assert.ok(!("authorization" in out.headers));
});

test("resolveOutbound never sees or returns live.token, in either auth mode", () => {
  const out1 = resolveOutbound(liveWithEnv, { method: "GET", path: "/x" });
  const out2 = resolveOutbound(live, { method: "GET", path: "/x", headers: { Authorization: "Bearer mine" } });
  for (const out of [out1, out2]) {
    assert.equal(out.ok, true);
    const flat = JSON.stringify(out);
    assert.ok(!flat.includes("SECRET-ENV-TOKEN"), "resolveOutbound's return value must never carry live.token");
  }
});

test("a body on a GET or HEAD request is refused", () => {
  for (const method of ["GET", "HEAD"]) {
    const out = resolveOutbound(live, { method, path: "/x", body: "{}" });
    assert.equal(out.ok, false, method);
  }
});

test("a body on POST/PUT/PATCH/DELETE is carried through", () => {
  const out = resolveOutbound(live, { method: "POST", path: "/x", body: "hello" });
  assert.equal(out.ok, true);
  assert.equal(out.body, "hello");
});

test("resolveOutbound re-asserts the loopback check per request, socket-free", () => {
  // A `live` object standing in for "the config was somehow wrong" — the
  // same defense-in-depth reasoning as resolveAllowed's second lstat check
  // in server.mjs. This must never be constructible via makeLive +
  // resolveTarget in the real CLI path; it is exercised directly here to
  // prove resolveOutbound does not blindly trust its own config.
  const badLive = { origin: "http://example.com", authEnv: null, token: null };
  const out = resolveOutbound(badLive, { method: "GET", path: "/x" });
  assert.equal(out.ok, false);
});

test("resolveOutbound refuses when live mode is off", () => {
  assert.equal(resolveOutbound(null, { method: "GET", path: "/x" }).ok, false);
});

/* ════════════════════ resolveTarget ════════════════════ */

const TARGET_ALLOW = ["127.0.0.1:3000", "localhost:3000", "[::1]:3000", "10.1.2.3:8080", "172.16.0.1", "172.31.255.255", "192.168.1.5", "app.localhost:3000"];

const TARGET_REFUSE = [
  "example.com",
  "169.254.169.254", // cloud metadata
  "172.32.0.1", // just outside 172.16.0.0/12 — the numeric-octet boundary
  "172.15.0.1", // just outside on the other side
  "127.0.0.1.evil.com", // defeats a lazy startsWith("127.")
  "0.0.0.0",
  "[fe80::1]",
  "user:pass@127.0.0.1",
  "127.0.0.1/api",
  "file:///etc/passwd",
  "ftp://",
  "",
  "not a url",
];

test("resolveTarget allows loopback and private-network specs", () => {
  for (const spec of TARGET_ALLOW) {
    const out = resolveTarget(spec);
    assert.equal(out.ok, true, `expected allow for ${spec}: ${out.reason}`);
    assert.equal(typeof out.origin, "string");
  }
});

test("resolveTarget refuses public hosts, metadata, boundary IPs, and malformed specs", () => {
  for (const spec of TARGET_REFUSE) {
    const out = resolveTarget(spec);
    assert.equal(out.ok, false, `expected refusal for ${JSON.stringify(spec)}`);
    assert.equal(typeof out.reason, "string");
  }
});

test("resolveTarget refuses non-string specs without throwing", () => {
  for (const spec of [42, null, undefined, {}]) {
    assert.equal(resolveTarget(spec).ok, false);
  }
});

/* ════════════════════ isPrivateHost — numeric-octet boundaries directly ════════════════════ */

test("isPrivateHost matches by parsed integer, never by string prefix", () => {
  assert.equal(isPrivateHost("172.16.0.1"), true);
  assert.equal(isPrivateHost("172.31.255.255"), true);
  assert.equal(isPrivateHost("172.32.0.1"), false);
  assert.equal(isPrivateHost("172.15.0.1"), false);
  assert.equal(isPrivateHost("127.0.0.1.evil.com"), false);
  assert.equal(isPrivateHost("169.254.169.254"), false);
  assert.equal(isPrivateHost("0.0.0.0"), false);
});

test("isPrivateHost handles IPv6 loopback, link-local, ULA, and v4-mapped forms", () => {
  assert.equal(isPrivateHost("::1"), true);
  assert.equal(isPrivateHost("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateHost("::ffff:169.254.169.254"), false);
  assert.equal(isPrivateHost("fe80::1"), false);
  assert.equal(isPrivateHost("fc00::1"), false);
  assert.equal(isPrivateHost("::"), false);
});

/* ════════════════════ rateBucket, with an injected clock ════════════════════ */

test("rateBucket refills lazily from an injected clock, no timer involved", () => {
  let t = 0;
  const bucket = rateBucket({ capacity: 2, perSec: 1, now: () => t });

  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false, "capacity exhausted");

  t += 500; // half a second — half a token at perSec: 1, still not enough
  assert.equal(bucket.take(), false);

  t += 500; // one full second elapsed since the last refill point
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
});

test("rateBucket never exceeds capacity even after a long idle gap", () => {
  let t = 0;
  const bucket = rateBucket({ capacity: 2, perSec: 1, now: () => t });
  t += 1_000_000; // a huge gap
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false, "must clamp to capacity, not accumulate unboundedly");
});

/* ════════════════════ liveLogLine — token cannot reach stderr ════════════════════ */

test("liveLogLine has no headers parameter — a token cannot be passed to it at all", () => {
  assert.equal(liveLogLine.length, 1); // one destructured params object, no headers slot
});

test("liveLogLine drops the query string, so a user-typed ?token= never reaches stderr", () => {
  const line = liveLogLine({ method: "GET", path: "/ok?token=SUPERSECRET", status: 200, ms: 43, bytes: 118 });
  assert.ok(!line.includes("SUPERSECRET"));
  assert.equal(line, "atlas live: GET /ok -> 200 in 43ms 118B");
});

test("liveLogLine formats the three documented shapes exactly", () => {
  assert.equal(liveLogLine({ method: "GET", path: "/ok", status: 200, ms: 43, bytes: 118 }), "atlas live: GET /ok -> 200 in 43ms 118B");
  assert.equal(liveLogLine({ method: "GET", path: "/slow", error: "timeout", ms: 10003 }), "atlas live: GET /slow -> timeout in 10003ms");
  assert.equal(
    liveLogLine({ method: "POST", path: "/x", refused: `header "cookie" is not forwardable` }),
    `atlas live: POST /x refused: header "cookie" is not forwardable`,
  );
});

/* ════════════════════ liveInfo — token-free by construction ════════════════════ */

test("liveInfo(live) never carries the token — structural check first, string search as backstop", () => {
  const secretLive = makeLive({ origin: "http://127.0.0.1:3000", authEnv: "ATLAS_TOKEN", token: "SUPERSECRET" });
  const info = liveInfo(secretLive);
  assert.ok(!("token" in info), "liveInfo's return value must not have a token key at all");
  assert.ok(!JSON.stringify(info).includes("SUPERSECRET"), "no string field may carry the token either");
  assert.equal(info.offered, true);
  assert.equal(info.auth, "env");
  assert.equal(info.authEnv, "ATLAS_TOKEN");
});

test("liveInfo(null) reports offered:false with a reason, never absent fields", () => {
  const info = liveInfo(null);
  assert.equal(info.offered, false);
  assert.equal(typeof info.reason, "string");
});

test("liveInfo(live) with no authEnv reports auth: none", () => {
  const info = liveInfo(live);
  assert.equal(info.auth, "none");
  assert.equal(info.authEnv, null);
});

/* ════════════════════ liveStats — no invented p95 ════════════════════ */

test("liveStats withholds p95 below n=5, always reports n", () => {
  for (let n = 0; n < 5; n++) {
    const stats = liveStats(Array.from({ length: n }, (_, i) => i + 1));
    assert.equal(stats.n, n);
    assert.ok(!("p95" in stats), `n=${n} must not carry a p95`);
  }
});

test("liveStats reports p95 at n=5 and above", () => {
  const stats = liveStats([10, 20, 30, 40, 50]);
  assert.equal(stats.n, 5);
  assert.ok("p95" in stats);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 50);
  assert.equal(stats.mean, 30);
});
