#!/usr/bin/env node
/**
 * Regenerates every image in this folder, from this repository.
 *
 * One command:  cd docs/screenshots && npm ci && node capture.mjs
 *
 * The subject is code-atlas itself, which is the honest choice: the map in the
 * README is the map you get by running the tool on the tool, so nothing in the
 * frame is arranged for the photograph. It also means the screenshots go stale
 * loudly, because the repository they draw is the one being changed.
 *
 * Playwright lives in this folder's own package.json, not the root's. The root
 * ships with no dependencies and that is a promise to anyone who runs `npx
 * code-atlas`; screenshot tooling is a contributor concern, so it sits behind
 * its own install the way desktop/ does.
 *
 * Two kinds of capture:
 *   - the viewer, opened as a file:// URL, driven through the same `setView`
 *     and `setThemeMode` globals the on-screen controls call
 *   - the terminal commands, whose stdout is plain text when piped, rendered
 *     into a monospace HTML page and shot the same way. There is no termshot or
 *     freeze dependency because there does not need to be one.
 *
 * Motion is disabled through Playwright's reducedMotion rather than by waiting
 * out the arrival animation: a headless page throttles requestAnimationFrame,
 * so waiting for an animation to finish is the one thing that does not work
 * here. The viewer already reads prefers-reduced-motion and draws its final
 * frame immediately when it is set.
 *
 * That covers the intro, the camera tween and the ambient packet field, but not
 * a view that plays a flow. Its runners advance against the wall clock, so two
 * runs caught the packet at two different points on its arc and rewrote
 * request-view.webp every time. `freeze()` below pins that, and the screenshots
 * ask Playwright to finish CSS transitions rather than shoot into one.
 *
 * Running this script twice in a row must leave `git status` clean. If it does
 * not, something is still reading the clock at shot time and belongs in
 * `freeze()`.
 *
 * One exception, and it is structural rather than a bug: the acquisition rung
 * leads `atlas scan`'s report, so terminal-scan.webp contains the commit it was
 * taken at. Committing the image moves HEAD past that commit, which means this
 * one file is always one commit behind and is rewritten by the next run. Every
 * other image is a function of the scanned tree alone, and the viewer never
 * draws the commit at all.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, statSync, readdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const ATLAS = path.join(REPO, "bin", "atlas.mjs");

/** Width the skill asks for. Height is generous; the viewer fills whatever it gets. */
const VIEWPORT = { width: 1600, height: 1000 };
const TERMINAL_COLUMNS = 120;
/** `atlas findings` prints 172 findings for this repo, which is a legible report and an illegible image. A screenshot shows the first screenful, the way a terminal does. `atlas scan` fits under this whole. */
const TERMINAL_LINES = 48;
const MAX_BYTES = 300 * 1024;

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

/** Run the CLI in this repository, capturing stdout as text. */
function atlas(args, { columns } = {}) {
  return execFileSync(process.execPath, [ATLAS, ...args], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, COLUMNS: String(columns ?? TERMINAL_COLUMNS), NO_COLOR: "1" },
  });
}

/**
 * PNG to WebP, stepping quality down until it fits.
 *
 * The 300 KB ceiling is the repo-conventions rule. Stepping rather than picking
 * one quality keeps the big isometric maps and the small terminal shots on the
 * same script without hand-tuning either.
 */
function toWebp(png) {
  const webp = png.replace(/\.png$/, ".webp");
  for (const q of [82, 72, 62, 50, 40]) {
    execFileSync("cwebp", ["-quiet", "-q", String(q), png, "-o", webp]);
    const { size } = statSync(webp);
    if (size <= MAX_BYTES) {
      console.log(`  ${path.basename(webp)}  ${kb(size)}  (q${q})`);
      unlinkSync(png);
      return webp;
    }
  }
  const { size } = statSync(webp);
  unlinkSync(png);
  throw new Error(`${path.basename(webp)} is ${kb(size)}, over the ${kb(MAX_BYTES)} ceiling even at q40`);
}

/** A terminal transcript as an HTML page: monospace, padded, sized to fit the columns. */
function terminalPage(command, output) {
  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const all = output.replace(/\s+$/, "").split("\n");
  const shown = all.slice(0, TERMINAL_LINES);
  // Counted, never guessed, and marked as the tool's own note rather than
  // dressed up as a line the command printed.
  const more = all.length > shown.length
    ? `\n<span class="more">... ${all.length - shown.length} more lines</span>`
    : "";
  return `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #15161a; }
    .term { padding: 28px 32px; font: 13px/1.55 ui-monospace, "SF Mono", Menlo, monospace; }
    /* pre-wrap, not pre: one scan line is far wider than 120 columns, and a real terminal wraps it rather than growing the window. Left as pre the page widened past the 1600px the screenshot is supposed to be. */
    pre { margin: 0; color: #cdd2dc; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
    .prompt { color: #7f8798; }
    .cmd { color: #e6e9ef; }
    .more { color: #6b7280; font-style: italic; }
  </style><div class="term" style="width: ${TERMINAL_COLUMNS}ch">
    <pre><span class="prompt">$</span> <span class="cmd">${escape(command)}</span>
${escape(shown.join("\n"))}${more}</pre>
  </div>`;
}

async function main() {
  // cwebp is the one external tool. Fail now with a usable message rather than
  // after a minute of browser work.
  try {
    execFileSync("cwebp", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("cwebp not found. Install it with `brew install webp` (or your platform's libwebp package).");
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), "atlas-shots-"));
  try {
    console.log("building the atlas of this repository...");
    const html = path.join(tmp, "atlas.html");
    atlas(["build", "--repo", REPO, "--out", html]);

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: "reduce" });
    const page = await context.newPage();

    await page.goto(pathToFileURL(html).href);
    // The viewer boots, lays out and draws before it hands back; waiting on the
    // canvas element alone would shoot an empty frame.
    await page.waitForFunction(() => typeof setView === "function" && typeof setThemeMode === "function");

    // First run shows the onboarding card over the middle of the map. Dismissed
    // through its own button rather than by pre-seeding localStorage, so the
    // capture goes through the same path a reader does.
    const go = page.locator("#obGo");
    if (await go.isVisible().catch(() => false)) await go.click();
    await page.waitForTimeout(1200);

    /**
     * Pin the frame, so the same view shot twice is the same bytes twice.
     *
     * Pausing alone is not enough: a runner paused at an arbitrary t is still an
     * arbitrary t. Resetting the yaw rebuilds the packets, which puts every
     * runner back on its first step at t=0, and that is a frame the viewer
     * reaches on its own rather than one this script arranges. The camera reset
     * is the `r` key's, so a shot never inherits the framing of the one before
     * it.
     */
    const freeze = () =>
      page.evaluate(() => {
        S.running = false;
        S.stepBudget = 0;
        resetOffsets();
        rotateTo(YAW0);
        fitView(true);
        renderCaption();
        syncControls();
        draw();
      });

    const shoot = async (name) => {
      await freeze();
      const png = path.join(HERE, `${name}.png`);
      // `animations: "disabled"` finishes any CSS transition at its end state
      // instead of catching it mid-fade. Pausing flips the transport button,
      // which fades over .12s, and shooting into that fade moved 222 pixels
      // between runs.
      await page.screenshot({ path: png, animations: "disabled" });
      return toWebp(png);
    };

    console.log("viewer:");
    // Light first: it is the default the README embeds.
    await page.evaluate(() => { setThemeMode("light"); setView("structure"); });
    await page.waitForTimeout(600);
    await shoot("structure-light");

    await page.evaluate(() => setThemeMode("dark"));
    await page.waitForTimeout(600);
    await shoot("structure-dark");

    await page.evaluate(() => { setThemeMode("light"); setView("request"); });
    await page.waitForTimeout(600);
    await shoot("request-view");

    await page.evaluate(() => setView("findings"));
    await page.waitForTimeout(600);
    await shoot("findings-view");

    console.log("terminal:");
    for (const [name, args] of [["scan", ["scan", "--repo", "."]], ["findings", ["findings", "--repo", "."]]]) {
      const out = atlas(args);
      const pageFile = path.join(tmp, `${name}.html`);
      writeFileSync(pageFile, terminalPage(`atlas ${args.join(" ")}`, out));
      await page.goto(pathToFileURL(pageFile).href);
      const png = path.join(HERE, `terminal-${name}.png`);
      await page.screenshot({ path: png, fullPage: true, animations: "disabled" });
      toWebp(png);
    }

    await browser.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const shots = readdirSync(HERE).filter((f) => f.endsWith(".webp")).sort();
  console.log(`\n${shots.length} images in docs/screenshots:`);
  for (const f of shots) console.log(`  ${f}  ${kb(statSync(path.join(HERE, f)).size)}`);
}

main().catch((e) => {
  console.error(`capture failed: ${e.message}`);
  process.exit(1);
});
