/**
 * The desktop shell's one load-bearing claim.
 *
 * The whole argument for Electron over Tauri is that `src/serve/server.mjs` and
 * `src/serve/proxy.mjs` run **as they are** in the main process, so the
 * allowlist, the symlink refusal, the size cap, the `Host` pinning and the
 * `Sec-Fetch-Site` check are the same code rather than a reimplementation of
 * it. That claim is only worth anything if a request shaped like the one a
 * `BrowserWindow` actually sends still passes, and one shaped like an attack
 * still does not.
 *
 * So this drives the real server with the exact header sets Chromium emits:
 * a top-level navigation, a same-origin `fetch` from the page, and — the case
 * that must fail — a cross-site fetch from some other page that has managed to
 * point itself at the loopback port. No Electron is installed to run this; the
 * headers are the interface, and they are what is asserted.
 *
 * The shell itself (`desktop/main.mjs`) is checked here only for the two
 * settings that would quietly hand the page more privilege than a browser tab
 * gives it. Everything else about it needs a window in front of a human.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scan } from "../src/build/build.mjs";
import { loadConfig } from "../src/config/load.mjs";
import { listen } from "../src/serve/server.mjs";
import { tmpRepo } from "./helpers.mjs";

const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "desktop");

/** The shell serves on port 0 and pins `Host` to whatever it got; this mirrors that exactly. */
async function serveLikeTheShell(t, dir) {
  const { payload } = scan({ repo: dir, ref: "fs", warn: () => {}, progress: () => {} });
  const { keep, exclude } = loadConfig();
  const server = await listen(0, { repo: dir, keep, exclude, payload });
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { port: server.address().port };
}

/** One request with headers spelled out, because the headers are the thing under test. */
function raw(port, reqPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: reqPath, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a BrowserWindow's top-level navigation is served", async (t) => {
  const dir = tmpRepo(t, "flat-app");
  const { port } = await serveLikeTheShell(t, dir);
  // What Chromium sends for `win.loadURL("http://127.0.0.1:PORT/")`.
  const res = await raw(port, "/", {
    host: `127.0.0.1:${port}`,
    "sec-fetch-site": "none",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  });
  assert.equal(res.status, 200);
  assert.match(res.body, /const ATLAS = /);
});

test("the page's own source fetch is served", async (t) => {
  const dir = tmpRepo(t, "flat-app");
  const { port } = await serveLikeTheShell(t, dir);
  const res = await raw(port, "/api/source?path=" + encodeURIComponent("src/server.ts"), {
    host: `127.0.0.1:${port}`,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body, readFileSync(path.join(dir, "src", "server.ts"), "utf8"));
});

test("a cross-site fetch at the same port is still refused, shell or no shell", async (t) => {
  const dir = tmpRepo(t, "flat-app");
  const { port } = await serveLikeTheShell(t, dir);
  const res = await raw(port, "/api/source?path=" + encodeURIComponent("src/server.ts"), {
    host: `127.0.0.1:${port}`,
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  });
  assert.equal(res.status, 403);
});

test("a forged Host is refused even from a correctly-shaped navigation", async (t) => {
  const dir = tmpRepo(t, "flat-app");
  const { port } = await serveLikeTheShell(t, dir);
  for (const host of ["localhost:" + port, "evil.example", "127.0.0.1:1"]) {
    const res = await raw(port, "/", {
      host,
      "sec-fetch-site": "none",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    });
    assert.equal(res.status, 403, `Host: ${host} was not refused`);
  }
});

test("two shells can serve at once — the port is never a fixed number", async (t) => {
  const dir = tmpRepo(t, "flat-app");
  const a = await serveLikeTheShell(t, dir);
  const b = await serveLikeTheShell(t, dir);
  assert.notEqual(a.port, b.port, "a second window would have collided with the first");
});

/* ── the shell's own privilege settings ───────────────────────────────────── */

test("the window is a browser tab, with no route from the page into Node", () => {
  const main = readFileSync(path.join(DESKTOP, "main.mjs"), "utf8");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  // No preload is the strongest form of "nothing to bridge", and it is the
  // claim the file's own comment makes. If one is ever added, this fails and
  // whoever adds it has to say what it exposes.
  assert.ok(!/preload\s*:/.test(main), "a preload script appeared — say what it exposes and what guards it");
});

test("the shell's dependency stays inside desktop/, so the core installs with none", () => {
  const desktop = JSON.parse(readFileSync(path.join(DESKTOP, "package.json"), "utf8"));
  const root = JSON.parse(readFileSync(path.join(DESKTOP, "..", "package.json"), "utf8"));
  assert.ok(desktop.devDependencies?.electron, "the shell should declare electron");
  assert.equal(root.dependencies, undefined, "a dependency reached the core package");
  assert.equal(root.devDependencies, undefined, "a devDependency reached the core package");
  assert.ok(!root.files.includes("desktop"), "the shell would ship inside the npm package");
});
