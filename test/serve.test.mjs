/**
 * `atlas serve` — the bind host, and the source-read allowlist.
 *
 * Every traversal shape in PLAN.md's Phase 7 gate must 404: `../../../etc/passwd`,
 * `/etc/passwd`, `.env`, `node_modules/x`, an in-repo symlink pointing outside the
 * repo, `..%2f..%2f`, and a mismatched `Host` header. The symlink is created with
 * `symlinkSync` into a tmpdir inside the test itself, so a fresh clone carries no
 * committed symlink and the walk's own symlink-skip is what keeps it out of the
 * allowlist in the first place — `resolveAllowed`'s `lstat` check is the second,
 * independent layer, and is exercised directly against a crafted allow set below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { scan } from "../src/build/build.mjs";
import { loadConfig } from "../src/config/load.mjs";
import { listen } from "../src/serve/server.mjs";
import { resolveAllowed } from "../src/serve/files.mjs";
import { FIXTURE_DIR } from "./helpers.mjs";

function copyFixture(name) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-serve-"));
  cpSync(path.join(FIXTURE_DIR, name), dir, { recursive: true });
  return dir;
}

async function startServer(dir) {
  const { payload } = scan({ repo: dir, ref: "fs", warn: () => {}, progress: () => {} });
  const { keep, exclude } = loadConfig();
  const server = await listen(0, { repo: dir, keep, exclude, payload });
  const port = server.address().port;
  return { server, port, base: `http://127.0.0.1:${port}` };
}

test("listen() binds 127.0.0.1 regardless of what a caller passes — there is no host parameter", async () => {
  const dir = copyFixture("flat-app");
  const { server, port } = await startServer(dir);
  try {
    assert.equal(server.address().address, "127.0.0.1");
    assert.equal(typeof port, "number");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET / serves the assembled viewer", async () => {
  const dir = copyFixture("flat-app");
  const { server, base } = await startServer(dir);
  try {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const body = await res.text();
    assert.match(body, /const ATLAS = /);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/source reads a file the scan actually kept", async () => {
  const dir = copyFixture("flat-app");
  const { server, base } = await startServer(dir);
  try {
    const res = await fetch(base + "/api/source?path=" + encodeURIComponent("src/server.ts"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
    const body = await res.text();
    assert.equal(body, readFileSync(path.join(dir, "src", "server.ts"), "utf8"));
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the traversal gate: every shape below 404s or is refused", async (t) => {
  const dir = copyFixture("flat-app");
  // A real file outside the walk's `keep`/`exclude` set: `.env` exists on disk,
  // proving the 404 comes from the allowlist, not from the file being absent.
  writeFileSync(path.join(dir, ".env"), "SECRET=1\n");
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  writeFileSync(path.join(dir, "node_modules", "x"), "module.exports = 1;\n");
  // Points outside the repo entirely — created here so a fresh clone has no
  // committed symlink.
  const outside = mkdtempSync(path.join(os.tmpdir(), "atlas-outside-"));
  const secretOutside = path.join(outside, "secret.ts");
  writeFileSync(secretOutside, "export const secret = 1;\n");
  symlinkSync(secretOutside, path.join(dir, "linked.ts"));

  const { server, base, port } = await startServer(dir);
  try {
    const cases = [
      ["../../../etc/passwd", "../../../etc/passwd"],
      ["/etc/passwd", "/etc/passwd"],
      [".env", ".env"],
      ["node_modules/x", "node_modules/x"],
      ["in-repo symlink pointing outside the repo", "linked.ts"],
      ["URL-encoded traversal", "..%2f..%2f"],
    ];
    for (const [label, rel] of cases) {
      await t.test(label, async () => {
        const res = await fetch(base + "/api/source?path=" + rel);
        assert.equal(res.status, 404, `expected 404 for ${label} (raw "${rel}")`);
      });
    }

    await t.test("Host: evil.example is refused", async () => {
      // fetch()/undici treat Host as a forbidden header and silently replace it
      // with the real connection host, so this needs the raw client to prove
      // the server actually inspects what it was sent.
      const status = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/api/source?path=src/server.ts", headers: { Host: "evil.example" } },
          (res) => resolve(res.statusCode),
        );
        req.on("error", reject);
        req.end();
      });
      assert.equal(status, 403);
    });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("resolveAllowed refuses a symlink even if it were somehow in the allow set", () => {
  const dir = copyFixture("flat-app");
  const outside = mkdtempSync(path.join(os.tmpdir(), "atlas-outside2-"));
  const secretOutside = path.join(outside, "secret.ts");
  writeFileSync(secretOutside, "export const secret = 1;\n");
  symlinkSync(secretOutside, path.join(dir, "linked.ts"));

  try {
    // A crafted allow set standing in for "the allowlist was somehow wrong" —
    // membership alone is not the only defense, `lstat` is the second one.
    const allow = new Set(["linked.ts"]);
    assert.equal(resolveAllowed(dir, allow, "linked.ts"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a file that exists but was never in the allow set is refused, even with a legitimate-looking name", () => {
  const dir = copyFixture("flat-app");
  try {
    const allow = new Set(["src/server.ts"]);
    assert.equal(resolveAllowed(dir, allow, "package.json"), null);
    assert.notEqual(resolveAllowed(dir, allow, "src/server.ts"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Adversarial pass — written against the finished implementation rather than
 * from its spec, so these are the shapes its own tests were not aimed at.
 * Spoken over a raw socket because `fetch` refuses to send a forged `Host`,
 * and the request line itself is part of what is under test.
 */
function rawRequest(port, lines) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => sock.write(lines.join("\r\n") + "\r\n\r\n"));
    let body = "";
    sock.setTimeout(3000);
    sock.on("data", (d) => (body += d));
    sock.on("timeout", () => { sock.destroy(); resolve(body); });
    sock.on("close", () => resolve(body));
    sock.on("error", () => resolve(body));
  });
}

test("a request with no Host header at all fails closed", async () => {
  const dir = copyFixture("flat-app");
  const { server, port } = await startServer(dir);
  try {
    // HTTP/1.0 does not require Host, so this reaches the handler with none.
    const res = await rawRequest(port, ["GET /api/source?path=src/server.ts HTTP/1.0"]);
    assert.match(res, /^HTTP\/1\.1 403/, "a missing Host was treated as same-origin");
  } finally {
    server.closeAllConnections?.();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an absolute request target is refused, whatever the Host says", async () => {
  const dir = copyFixture("flat-app");
  const { server, port } = await startServer(dir);
  try {
    // Proxy-form. Its authority and the Host header are two sources of truth
    // for one question, so the form is refused rather than reconciled.
    const spoofed = await rawRequest(port, [
      "GET http://evil.example/api/source?path=src/server.ts HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
    ]);
    assert.match(spoofed, /^HTTP\/1\.1 400/);
    assert.ok(!spoofed.includes("export const"), "served source through an absolute request target");
  } finally {
    server.closeAllConnections?.();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an allowlisted file swapped for a symlink after the scan is refused", async () => {
  const dir = copyFixture("flat-app");
  const { server, base } = await startServer(dir);
  const secret = path.join(mkdtempSync(path.join(os.tmpdir(), "atlas-outside-")), "secret.txt");
  try {
    // The allowlist was built when this really was a file. `lstat` at request
    // time is what stops the swap, which is why it cannot be hoisted to scan time.
    writeFileSync(secret, "TOP-SECRET-OUTSIDE-REPO\n");
    rmSync(path.join(dir, "src/server.ts"));
    symlinkSync(secret, path.join(dir, "src/server.ts"));

    const res = await fetch(`${base}/api/source?path=src/server.ts`);
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes("TOP-SECRET"));
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("encoded traversal and a null byte are refused like any other non-member", async () => {
  const dir = copyFixture("flat-app");
  const { server, base } = await startServer(dir);
  try {
    for (const p of ["..%252f..%252fetc%252fpasswd", "src%2Fserver.ts%00.png", "src/server.ts/../../../etc/passwd"]) {
      const res = await fetch(`${base}/api/source?path=${p}`);
      assert.equal(res.status, 404, `${p} was not refused`);
    }
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a cross-site top-level navigation is allowed; a cross-site fetch is not", async () => {
  const dir = copyFixture("flat-app");
  const { server, port } = await startServer(dir);
  try {
    // Following a link to this server from any other page sends
    // `Sec-Fetch-Site: cross-site`. Refusing that made the server 403 its own
    // URL — found by navigating to it from a page on a different port.
    const nav = await rawRequest(port, [
      "GET / HTTP/1.1", `Host: 127.0.0.1:${port}`,
      "Sec-Fetch-Site: cross-site", "Sec-Fetch-Mode: navigate", "Sec-Fetch-Dest: document",
    ]);
    assert.match(nav, /^HTTP\/1\.1 200/, "a person following a link was refused");

    // The attack shape — another origin reading this one's responses — stays refused.
    const fetched = await rawRequest(port, [
      "GET /api/source?path=src/server.ts HTTP/1.1", `Host: 127.0.0.1:${port}`,
      "Sec-Fetch-Site: cross-site", "Sec-Fetch-Mode: cors", "Sec-Fetch-Dest: empty",
    ]);
    assert.match(fetched, /^HTTP\/1\.1 403/);
    assert.ok(!fetched.includes("export const"));
  } finally {
    server.closeAllConnections?.();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
