#!/usr/bin/env node
/** atlas — isometric, interactive maps of a codebase. Read-only on the target repository, `atlas init` excepted, and it refuses to overwrite. `build` logs to stderr so `--json` stdout stays a clean payload; `scan` reports on stdout, where the report is the output. */
import { parseArgs } from "node:util";
import { writeFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scan } from "../src/build/build.mjs";
import { report, diagnose, findingsReport } from "../src/cli/report.mjs";
import { assemble } from "../src/build/assemble.mjs";
import { makeProgress } from "../src/cli/progress.mjs";
import { starterConfig } from "../src/config/init.mjs";
import { loadConfig } from "../src/config/load.mjs";
import { listen } from "../src/serve/server.mjs";
import { resolveTarget, makeLive } from "../src/serve/proxy.mjs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

// Draws nothing unless stderr is a terminal, so a redirect or a pipe is untouched.
const progress = makeProgress(process.stderr);
const warn = (...m) => {
  progress.clear();
  process.stderr.write(m.join(" ") + "\n");
};
const die = (msg) => {
  warn(`fatal: ${msg}`);
  process.exit(1);
};

const USAGE = `atlas                          map the repo you are in, and open it
atlas <command> [options]

  build      scan a repository and write a self-contained HTML atlas
  scan       what the scanner found, and what it could not
  init       write a starter config by inspecting the repo
  findings   cycles, layering violations, orphans, and the rest of the graph
  serve      local viewer with source reading

options
  --repo PATH      repository to scan            (default: .)
  --config FILE    config module                 (optional: detected otherwise)
  --ref REF        git ref, or \`worktree\` / \`fs\`  (default: HEAD)
  --out FILE       output html                   (default: atlas.html)
  --json           print the payload, write no HTML
  --no-fetch       skip \`git fetch origin\` for an origin/* ref
  --strict         fail, instead of warning, on stale curated flows

build options
  --embed-source [glob]   bake repo-relative file text into the HTML, all
                           scanned files or only those matching glob — the
                           shareable HTML then contains that source
  --gzip-source           store embedded source gzip-compressed, inflated
                           in the browser (needs --embed-source)
  --include-vendor        draw node_modules, vendor/ and virtualenvs too.
                           Off by default: a mid-size repo has tens of
                           thousands of these and the map stops being legible

serve options
  --port PORT      loopback port to bind         (default: 4173)
  --open           open the viewer in a browser once it is listening
  --target URL     origin the live proxy sends to. Loopback or private
                    addresses only, and never resolved by name — type the IP
  --allow-live     permit LIVE mode at all; needs --target. MOCK otherwise
  --auth-env VAR   inject Authorization from this environment variable, so the
                    token never enters the browser
`;

/** `--embed-source [glob]` is pulled out of argv first, since `node:util` has no optionally-valued flag; anything not matching the three accepted forms is left for `parseArgs`, so a real mistake still surfaces as its own error. */
function extractEmbedSource(argv) {
  const rest = [];
  let embedSource = false, embedGlob = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--embed-source" || a.startsWith("--embed-source=")) {
      embedSource = true;
      if (a.includes("=")) { embedGlob = a.slice(a.indexOf("=") + 1) || null; continue; }
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) { embedGlob = next; i++; }
      continue;
    }
    rest.push(a);
  }
  return { argv: rest, embedSource, embedGlob };
}

const { argv: filteredArgv, embedSource, embedGlob } = extractEmbedSource(process.argv.slice(2));

const { values, positionals } = parseArgs({
  args: filteredArgv,
  allowPositionals: true,
  options: {
    repo: { type: "string", default: "." },
    config: { type: "string" },
    ref: { type: "string", default: "HEAD" },
    out: { type: "string", default: "atlas.html" },
    json: { type: "boolean", default: false },
    "no-fetch": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    "gzip-source": { type: "boolean", default: false },
    "include-vendor": { type: "boolean", default: false },
    port: { type: "string", default: "4173" },
    target: { type: "string" },
    "allow-live": { type: "boolean", default: false },
    "auth-env": { type: "string" },
    open: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

/**
 * Bare `atlas` maps the repo you are standing in and opens it. It scans the
 * WORKTREE, not HEAD: someone who just typed `atlas` wants the code they are
 * working on, and the default ref would have quietly shown them their last
 * commit instead.
 */
const quickstart = positionals.length === 0;
const command = quickstart ? "build" : positionals[0];
if (quickstart) {
  if (!process.argv.includes("--ref")) values.ref = "worktree";
  if (!values.json) values.open = true;
}

const PENDING = {};
if (PENDING[command]) die(`\`atlas ${command}\` lands in phase ${PENDING[command]}`);
if (!["build", "scan", "init", "serve", "findings"].includes(command)) die(`unknown command "${command}"\n\n${USAGE}`);

// No config means defaults plus detection; a config only ever overrides what it names.
const repo = path.resolve(values.repo);

// The one command that writes to a target repo, and only a file it has never seen: an existing config was written by a person.
if (command === "init") {
  const file = path.join(repo, "atlas.config.mjs");
  if (existsSync(file)) die(`${file} already exists — delete it first, or edit it in place`);
  const { text, services, fileCount } = starterConfig(repo);
  writeFileSync(file, text);
  warn(`atlas: wrote ${file}`);
  warn(`atlas: ${services.length} service(s) detected over ${fileCount} files -> ${services.map((s) => s.id).join(", ")}`);
} else {
  await run();
}

/** Everything past acquisition, and no `process.exit()` near a write: stdout is async when it is a pipe, so exiting truncated `--json` at the 64 KB buffer. Letting the event loop run dry is what flushes it. */
async function run() {
  const config = values.config
    ? (await import(pathToFileURL(path.resolve(values.config)).href)).default
    : undefined;

  // `serve` reads off disk rather than a snapshot: `fs` acquisition means `source.dir` is the repo itself, with no temp dir to keep alive past `scan()`.
  const ref = command === "serve" ? "fs" : values.ref;

  // `--embed-source`/`--gzip-source` are build-only: elsewhere they would pay for embedding a payload nothing writes.
  const embedding = command === "build" && embedSource;
  if (values["gzip-source"] && !embedding) {
    warn("atlas: --gzip-source has no effect without --embed-source" + (command === "build" ? "" : " (and only applies to build)"));
  }

  // Live flags are validated before the scan, so a typo'd target costs a message rather than a full walk. `--target` is outbound-only: the bind host is a literal in listen(), never a flag.
  let live = null;
  const liveFlags = ["target", "allow-live", "auth-env"].filter((f) => values[f]);
  if (command !== "serve" && liveFlags.length) {
    warn(`atlas: ${liveFlags.map((f) => "--" + f).join(", ")} only applies to serve`);
  } else if (values["allow-live"]) {
    if (!values.target) die("--allow-live needs --target URL — the proxy has no origin without one");
    const t = resolveTarget(values.target);
    if (!t.ok) die(`--target ${values.target} — ${t.reason}`);
    let token = null;
    if (values["auth-env"]) {
      token = process.env[values["auth-env"]];
      // Starting anyway would send every request unauthenticated, after you said you had a token.
      if (!token) die(`--auth-env ${values["auth-env"]} is not set in this environment`);
    }
    live = makeLive({ origin: t.origin, authEnv: values["auth-env"] ?? null, token });
  } else if (values.target && command === "serve") {
    warn("atlas: --target has no effect without --allow-live — serving in MOCK only");
  }

  let result;
  try {
    result = scan({
      repo,
      ref,
      config,
      fetch: !values["no-fetch"],
      // A generic tool cannot hard-exit on somebody else's stale curated flow.
      strict: values.strict,
      embedSource: embedding,
      embedGlob,
      gzipSource: embedding && values["gzip-source"],
      includeVendor: values["include-vendor"],
      warn,
      progress,
    });
  } catch (e) {
    progress.done();
    die(e.message);
  }
  progress.done();

  const { payload, diagnostics } = result;

  // A command's output goes to stdout, its commentary to stderr; the report is `scan`'s output and `build`'s commentary.
  if (command === "scan") {
    diagnose(payload, diagnostics, (...m) => process.stdout.write(m.join(" ") + "\n"));
    return;
  }

  // Findings are the output, so they go to stdout and `--json` stays pipeable, matching what `--json` already means on `build`.
  if (command === "findings") {
    if (values.json) {
      process.stdout.write(JSON.stringify(payload.findings, null, 2));
    } else {
      findingsReport(payload, (...m) => process.stdout.write(m.join(" ") + "\n"));
    }
    return;
  }

  report(payload, diagnostics, warn);

  if (command === "serve") {
    const { keep, exclude } = loadConfig(config);
    let server;
    try {
      server = await listen(Number(values.port), { repo, keep, exclude, payload, live, log: warn });
    } catch (e) {
      die(`could not start server — ${e.message}`);
    }
    const url = `http://127.0.0.1:${server.address().port}`;
    warn(`atlas: serving ${url}`);
    // Named on startup, so the mode is never a surprise discovered mid-session.
    warn(live
      ? `atlas: LIVE enabled -> ${live.origin}${live.authEnv ? ` (Authorization from $${live.authEnv})` : ""}`
      : "atlas: MOCK only — nothing will be sent");
    if (values.open) openBrowser(url);
    return; // the server keeps the event loop alive; nothing left to do
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.source) {
    const added = Buffer.byteLength(JSON.stringify(payload.source), "utf8");
    warn(
      `atlas: --embed-source added ${(added / 1024).toFixed(0)} KB` +
      `${payload.source.gzip ? " (gzip-compressed)" : " — rebuild with --gzip-source to shrink it"}` +
      ` — ${payload.source.paths.length} file(s)${payload.source.glob ? ` matching "${payload.source.glob}"` : ""} now travel inside the HTML`,
    );
  }

  const out = path.resolve(values.out);
  writeFileSync(out, assemble(payload));
  warn(`atlas: wrote ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
  if (values.open) openBrowser(pathToFileURL(out).href);

  await offerConfig(payload, diagnostics);
}

/**
 * The one question worth asking, and only when the answer would change the map:
 * a repo where many files matched no layer rule renders as a tall UNSORTED
 * column, and a starter config is what fixes it. Silent unless a person is
 * watching a terminal, so scripts and pipes are never blocked on stdin.
 */
async function offerConfig(payload, diagnostics) {
  if (!quickstart || values.json) return;
  if (!process.stdin.isTTY || !process.stderr.isTTY) return;
  if (values.config || existsSync(path.join(repo, "atlas.config.mjs"))) return;

  const files = payload.nodes.filter((n) => n.kind === "file");
  const unsorted = files.filter((n) => n.layer === "unsorted").length;
  if (!files.length || unsorted / files.length < 0.25) return;

  const pct = Math.round((unsorted / files.length) * 100);
  warn("");
  warn(`atlas: ${pct}% of files matched no layer rule, so they are stacked in UNSORTED.`);
  warn("       A starter config names your services and columns and fixes that.");
  // The atlas is already written by the time we ask, so nothing that happens to
  // the prompt is worth failing the run over: a closed stdin or a Ctrl-C reads
  // as "no" rather than as a stack trace over a build that succeeded.
  let answer = "";
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    answer = (await rl.question("       Write atlas.config.mjs? [y/N] ")).trim().toLowerCase();
  } catch {
    warn("");
  } finally {
    rl.close();
  }
  if (answer !== "y" && answer !== "yes") {
    warn("atlas: skipped — run `atlas init` later, or see docs/config.md");
    return;
  }
  const { text, services, fileCount } = starterConfig(repo);
  const file = path.join(repo, "atlas.config.mjs");
  writeFileSync(file, text);
  warn(`atlas: wrote ${file} — ${services.length} service(s) over ${fileCount} files`);
  warn("atlas: edit it, then run `atlas` again");
}

/** Best-effort only — `--open` is a convenience, not something worth failing serve over. */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] :
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch (e) {
    warn(`warn: could not open a browser — ${e.message}`);
  }
}
