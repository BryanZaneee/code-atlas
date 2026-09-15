# code-atlas desktop

A window around the atlas. It is thin on purpose.

```bash
cd desktop
npm install          # ~150 MB, and the only install in this repository
npm start            # opens the last repo you mapped, or asks
npm start -- ~/code/some-repo
```

## What it is

The Electron main process runs `src/serve/server.mjs` — the same server
`atlas serve` runs, not a copy of it — on a random loopback port, and points a
window at it. That is the whole application. `⌘O` opens a folder, `⌘R` rescans
the working tree, and the File menu remembers the last eight repositories.

The window has no more privilege than a browser tab: `contextIsolation` on,
`nodeIntegration` off, `sandbox` on, and **no preload script**. Every native
action lives in the menu, which runs in the main process, so the page never
needs a bridge to reach one — and a page with no bridge cannot be talked into
crossing it. `test/desktop.test.mjs` asserts those settings and drives the real
server with the exact headers Chromium sends, including the cross-site fetch
that must still get a 403.

## Why Electron and not Tauri

Reuse before speed. Electron's main process is Node, so the allowlist, the
`lstat` symlink refusal, the size cap, the `Host` pinning and the server-side
token injection all carry over as running code. Tauri would mean rewriting them
in Rust, and a security posture that gets rewritten is one that gets re-argued
by whoever is in a hurry.

Speed agrees: the renderer's hot loop is thousands of canvas fills a frame,
which is where a non-Chromium webview struggles, and Tauri hands the renderer
WKWebView on macOS and WebKitGTK on Linux.

The cost, plainly: a ~150 MB artifact where Tauri would be ~8 MB. PLAN.md
carries the full argument under "Decisions reversed".

## What it does not do yet

No code signing, no notarization, no auto-update, no release pipeline. Live mode
is not wired to the menu either — use `atlas serve --allow-live --target …` for
that, where the flags make the decision explicit.

## The core is untouched

`npm install code-atlas` still pulls nothing. This directory has its own
`package.json`, the root's `files:` does not include it, and a test asserts both.
