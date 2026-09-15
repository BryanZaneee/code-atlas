/**
 * The desktop shell.
 *
 * It is deliberately thin. The Electron main process is Node, so
 * `src/serve/server.mjs` and `src/serve/proxy.mjs` run exactly as they do under
 * `atlas serve` — the allowlist, the `lstat` symlink refusal, the size cap, the
 * `Host` pinning, the `Sec-Fetch-Site` check and the server-side token
 * injection are the same code, not a reimplementation. That reuse is the reason
 * this is Electron and not Tauri; PLAN.md carries the argument.
 *
 * The window is a browser tab with no extra privilege: `contextIsolation` on,
 * `nodeIntegration` off, and **no preload script at all**. Every native action
 * lives in the menu, which runs in this process, so the page never needs a
 * bridge to reach one. A page that cannot call into Node cannot be talked into
 * calling into Node.
 */
import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

import { scan } from "../src/build/build.mjs";
import { listen } from "../src/serve/server.mjs";
import { loadConfig } from "../src/config/load.mjs";

/* ── the little bit of state worth keeping between launches ───────────────── */

const stateFile = (name) => path.join(app.getPath("userData"), name);

function readState(name, fallback) {
  try {
    return JSON.parse(readFileSync(stateFile(name), "utf8"));
  } catch {
    return fallback;   // first launch, or a file this build no longer reads
  }
}

function writeState(name, value) {
  try {
    writeFileSync(stateFile(name), JSON.stringify(value));
  } catch {
    /* a read-only profile; the app still works, it just forgets */
  }
}

const MAX_RECENT = 8;
function remember(repo) {
  const recent = [repo, ...readState("recent.json", []).filter((p) => p !== repo)].slice(0, MAX_RECENT);
  writeState("recent.json", recent);
  app.addRecentDocument?.(repo);
  return recent;
}

/* ── the server behind the window ─────────────────────────────────────────── */

let server = null;
let current = null;
let win = null;

/**
 * Scan a repository and serve it on a fresh loopback port.
 *
 * Port 0, so the OS picks: two windows, or a stale process, must never fight
 * over 4173. The previous server is closed first — a rescan should not leave a
 * listener behind holding the old file allowlist open.
 */
async function serve(repo) {
  // `fs` acquisition, exactly as `atlas serve` uses: source reads come off the
  // working tree, so the map matches what is actually on disk right now.
  const { payload } = scan({ repo, ref: "fs", warn: () => {} });
  const { keep, exclude } = loadConfig();
  await new Promise((r) => (server ? server.close(r) : r()));
  server = await listen(0, { repo, keep, exclude, payload });
  current = repo;
  remember(repo);
  buildMenu();
  return `http://127.0.0.1:${server.address().port}/`;
}

async function open(repo) {
  try {
    const url = await serve(repo);
    await win.loadURL(url);
    win.setTitle(`${path.basename(repo)} · code atlas`);
  } catch (err) {
    dialog.showErrorBox("Could not map that folder", `${repo}\n\n${err.message}`);
  }
}

async function pick() {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose a repository to map",
    properties: ["openDirectory"],
    defaultPath: current ?? app.getPath("home"),
  });
  if (!r.canceled && r.filePaths[0]) await open(r.filePaths[0]);
}

/* ── window ───────────────────────────────────────────────────────────────── */

function createWindow() {
  const saved = readState("window.json", { width: 1440, height: 900 });
  win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0d16",
    title: "code atlas",
    webPreferences: {
      // The page gets no more privilege than it has in a browser tab, which is
      // the whole security argument: there is no preload and nothing to bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  const saveBounds = () => {
    if (win.isMinimized() || win.isFullScreen()) return;
    writeState("window.json", win.getNormalBounds());
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);

  // A link out of the map opens in the real browser; nothing navigates this
  // window away from the loopback server it was given.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!server || !url.startsWith(`http://127.0.0.1:${server.address().port}/`)) e.preventDefault();
  });

  return win;
}

/* ── menu ─────────────────────────────────────────────────────────────────── */

function buildMenu() {
  const recent = readState("recent.json", []);
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Repository…", accelerator: "CmdOrCtrl+O", click: pick },
        {
          label: "Open Recent",
          submenu: recent.length
            ? recent.map((p) => ({ label: p, click: () => open(p) }))
            : [{ label: "Nothing yet", enabled: false }],
        },
        { type: "separator" },
        {
          label: "Rescan",
          accelerator: "CmdOrCtrl+R",
          enabled: Boolean(current),
          // A rescan re-reads the working tree, which is the point of the button:
          // the map should be able to catch up with what you just edited.
          click: () => current && open(current),
        },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" }] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

app.whenReady().then(async () => {
  createWindow();
  buildMenu();
  // A folder named on the command line, then the last one opened, then ask.
  const asked = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const last = readState("recent.json", [])[0];
  const start = asked ? path.resolve(asked) : last;
  if (start) await open(start);
  else await pick();
  if (!current) app.quit();
});

app.on("window-all-closed", () => {
  server?.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});
