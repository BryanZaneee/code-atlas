/**
 * LIVE mode, as a person meets it.
 *
 * `test/proxy.test.mjs` proves what may be sent and `test/live.test.mjs` proves
 * the endpoint in front of it. This file is about the only question those two
 * cannot answer: whether one genuinely observed fact, arriving next to a path
 * the tool merely modelled, stays distinguishable from it.
 *
 * The assertion that matters most is the dullest-looking one — that no step
 * object ever grows a timing field. `ms / steps.length` is one line, it would
 * look reasonable in a diff, and it would be a fabrication: the tool never
 * watches a request cross an internal hop. The test is structural rather than
 * about any particular field name, so it survives a refactor and fails the day
 * somebody adds one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadViewer, openComposer as open } from "./viewer-harness.mjs";
import { liveInfo, makeLive } from "../src/serve/proxy.mjs";
import { scanFixture } from "./helpers.mjs";

function load(atlas, { protocol = "http:", reply = null, replyStatus = 200 } = {}) {
  const store = new Map();
  const sent = [];
  const scope = loadViewer(atlas, {
    protocol,
    env: {
      navigator: {},
      sessionStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
      // `reply` is what the proxy would have returned, so a 401 here is the
      // shape a real refusal arrives in rather than an invented one.
      fetch: async (url, init) => {
        sent.push({ url, body: JSON.parse(init.body) });
        return {
          ok: replyStatus === 200,
          status: replyStatus,
          json: async () => reply,
          text: async () => (typeof reply === "string" ? reply : JSON.stringify(reply)),
        };
      },
    },
    exports: `REQ, LIVE,
       reqEndpoints, reqState, reqParamNames,
       liveOffered, liveReason, liveSend, liveCurl, liveClassOf, liveStatLine,
       liveSetToken, liveToken, liveStats,`,
  });
  scope.sent = sent;
  scope.store = store;
  return scope;
}

const OK = { status: 200, statusText: "OK", ms: 17, bytes: 12, truncated: false, redirected: false };
const DENIED = { status: 401, statusText: "Unauthorized", ms: 9, bytes: 3, truncated: false, redirected: false };

async function fixture(live = liveInfo(makeLive({ origin: "http://127.0.0.1:4599" }))) {
  const { payload } = await scanFixture("mini-monorepo");
  return { ...payload, live };
}

const panel = (scope) => scope.$("#insBody").textContent;

/* ── whether LIVE is on offer at all ──────────────────────────── */

test("LIVE is offered only when a server said so", async () => {
  const served = load(await fixture());
  assert.equal(served.liveOffered(), true);

  const off = load(await fixture(liveInfo(null)));
  assert.equal(off.liveOffered(), false);
  assert.match(off.liveReason(), /--allow-live/, "the reason has to come from the server");
});

/**
 * A built atlas carrying its own source is source-capable and has no server
 * behind it. That distinction is why this is gated on the protocol rather than
 * on whether the SOURCE tab works.
 */
test("a file:// atlas is never offered LIVE, whatever it carries", async () => {
  const scope = load(await fixture(), { protocol: "file:" });
  assert.equal(scope.liveOffered(), false);
  assert.match(scope.liveReason(), /atlas serve/, "the reason should say what to do about it");
});

test("MOCK is the default, as a fact rather than an inference", async () => {
  const scope = load(await fixture());
  assert.equal(scope.S.mode, "mock");
});

test("the composer says why LIVE is unavailable rather than hiding it", async () => {
  const scope = load(await fixture(liveInfo(null)));
  open(scope);
  scope.renderInspect();
  assert.match(panel(scope), /--allow-live/);
});

/* ── sending ──────────────────────────────────────────────────── */

test("a live send posts a path and never a host", async () => {
  const scope = load(await fixture(), { reply: OK });
  const ep = open(scope, "GET /api/users/:id");
  scope.S.mode = "live";
  await scope.liveSend();

  assert.equal(scope.sent.length, 1);
  assert.equal(scope.sent[0].url, "/api/live");
  const body = scope.sent[0].body;
  assert.ok(body.path.startsWith("/"), `expected a path, got ${body.path}`);
  assert.ok(!("host" in body) && !("url" in body) && !("target" in body),
    "the page must never name a destination");
  assert.ok(body.path.includes("42"), "the substituted value should be what is sent");
});

test("a 2xx arms the whole modelled path", async () => {
  const scope = load(await fixture(), { reply: OK });
  open(scope, "GET /api/users");
  scope.S.mode = "live";
  await scope.liveSend();
  assert.ok(scope.S.request.steps.length > 1, "a success should play the path");
  assert.equal(scope.S.request.live.status, 200);
  assert.equal(scope.S.running, true);
});

/**
 * The request reached the endpoint, which is observed. Everything past it is a
 * route the tool modelled for a journey that did not finish, so it is not drawn.
 */
test("a non-2xx halts at hop 1 and says why", async () => {
  const scope = load(await fixture(), { reply: DENIED });
  open(scope, "GET /api/users");
  scope.S.mode = "live";
  await scope.liveSend();

  assert.equal(scope.S.request.steps.length, 1, "a 401 must not animate a success path");
  assert.equal(scope.S.running, false);
  scope.renderInspect();
  assert.match(panel(scope), /401/);
  assert.match(panel(scope), /stops at the first hop/i);
});

/* ── the thing this file exists for ───────────────────────────── */

/**
 * Structural, and deliberately not about one field name: the tool never watches
 * a request cross an internal hop, so a step carrying any timing at all is a
 * number that was invented. Written to fail the day `ms / steps.length` shows up.
 */
test("no step ever carries a timing, whatever the response said", async () => {
  for (const reply of [OK, DENIED]) {
    const scope = load(await fixture(), { reply });
    open(scope, "GET /api/users");
    scope.S.mode = "live";
    await scope.liveSend();

    for (const step of scope.S.request.steps) {
      for (const key of Object.keys(step)) {
        assert.ok(!/^(ms|latency|duration|elapsed|took|t0|time|timing)$/i.test(key),
          `step grew a timing field: ${key}`);
      }
      assert.ok(!("live" in step), "a response belongs to the path, never to a hop");
    }
  }
});

test("the canvas says the status was observed and the path was not", async () => {
  const scope = load(await fixture(), { reply: OK });
  open(scope, "GET /api/users");
  scope.S.mode = "live";
  await scope.liveSend();
  const badge = scope.$("#ovWarn").textContent;
  assert.match(badge, /LIVE/);
  assert.match(badge, /OBSERVED/);
  assert.match(badge, /MODELLED/, "the badge must keep the path modelled");
});

test("the endpoint ring colours by status class, and drawing does not throw", async () => {
  const scope = load(await fixture(), { reply: DENIED });
  open(scope, "GET /api/users");
  scope.S.mode = "live";
  await scope.liveSend();
  assert.equal(scope.liveClassOf(200), "ok");
  assert.equal(scope.liveClassOf(404), "client");
  assert.equal(scope.liveClassOf(503), "server");
  assert.equal(scope.liveClassOf(null), "server");
  assert.doesNotThrow(() => scope.draw());
});

/* ── statistics ───────────────────────────────────────────────── */

test("repeat statistics count the samples and withhold what they cannot support", async () => {
  const scope = load(await fixture(), { reply: OK });
  const ep = open(scope, "GET /api/users");
  scope.S.mode = "live";
  await scope.liveSend();
  await scope.liveSend();

  const line = scope.liveStatLine(ep.id);
  assert.match(line, /n=2/);
  assert.ok(!/p95/.test(line), "a p95 over two samples is not a p95");
  for (let i = 0; i < 4; i++) await scope.liveSend();
  assert.match(scope.liveStatLine(ep.id), /p95/, "with enough samples it appears");
});

/**
 * The rule this shares with the refusal to draw per-hop timings: a number the
 * tool has not earned does not get printed. Asserted directly rather than only
 * through the rendered line, so the threshold is pinned rather than incidental.
 */
test("liveStats withholds p95 below n=5 and always reports n", async () => {
  const scope = load(await fixture());
  // Compared field-by-field: the object comes from the VM realm, and deepEqual
  // checks prototypes even when every value matches.
  const empty = scope.liveStats([]);
  assert.equal(empty.n, 0);
  assert.ok(!("p95" in empty) && !("min" in empty));
  for (let n = 1; n < 5; n++) {
    const s = scope.liveStats(Array.from({ length: n }, (_, i) => i + 1));
    assert.equal(s.n, n);
    assert.ok(!("p95" in s), `quoted a p95 over ${n} sample(s)`);
  }
  const five = scope.liveStats([10, 20, 30, 40, 50]);
  assert.equal(five.n, 5);
  assert.equal(five.min, 10);
  assert.ok("p95" in five);
});

test("samples are never persisted — a restored latency would read as fresh", async () => {
  const scope = load(await fixture(), { reply: OK });
  open(scope, "GET /api/users");
  scope.S.mode = "live";
  await scope.liveSend();
  const stored = [...scope.store.values()].join("");
  assert.ok(!stored.includes("17"), "a latency sample reached storage");
});

/* ── the token ────────────────────────────────────────────────── */

test("with --auth-env the page is told the variable name and offered no field", async () => {
  const info = liveInfo(makeLive({ origin: "http://127.0.0.1:4599", authEnv: "AUTH_TOKEN", token: "SUPERSECRET" }));
  const scope = load(await fixture(info));
  open(scope);
  scope.S.mode = "live";
  scope.renderInspect();

  assert.match(panel(scope), /AUTH_TOKEN/, "the variable name is what makes COPY AS cURL runnable");
  assert.ok(!panel(scope).includes("SUPERSECRET"), "the value must never be here");
  assert.equal(scope.liveToken(), null, "the page must not hold a token the server injects");
});

test("without --auth-env the page keeps its own token for the tab, and can clear it", async () => {
  const scope = load(await fixture());
  open(scope);
  scope.liveSetToken("Bearer mine");
  assert.equal(scope.liveToken(), "Bearer mine");
  scope.liveSetToken("");
  assert.equal(scope.liveToken(), "");
  assert.ok(![...scope.store.values()].join("").includes("Bearer mine"), "CLEAR must actually clear");
});

test("cURL prints the variable, never a value, and points at the real target", async () => {
  const info = liveInfo(makeLive({ origin: "http://127.0.0.1:4599", authEnv: "AUTH_TOKEN", token: "SUPERSECRET" }));
  const scope = load(await fixture(info));
  open(scope, "GET /api/users");
  const curl = scope.liveCurl();
  assert.match(curl, /^curl -i -X GET/);
  assert.match(curl, /127\.0\.0\.1:4599/);
  assert.match(curl, /\$AUTH_TOKEN/);
  assert.ok(!curl.includes("SUPERSECRET"));
});
