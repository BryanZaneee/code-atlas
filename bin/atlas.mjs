#!/usr/bin/env node
/**
 * atlas — isometric, interactive maps of a codebase.
 *
 * Read-only on the target repository: the ref is extracted with `git archive`
 * into a temp directory, so no branch is switched and no file is modified.
 * `atlas init` is the only command permitted to write to a target repo, and it
 * refuses to overwrite.
 *
 *   atlas build --repo . [--config atlas.config.mjs] [--ref R] [--out f] [--json]
 *   atlas scan  --repo .
 *   atlas init  --repo .
 *
 * `build` logs to stderr so `--json` stdout is a clean payload; `scan` reports
 * on stdout, because there the report is the output rather than the commentary.
 */
import { parseArgs } from "node:util";
import { writeFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scan, report, diagnose } from "../src/build/build.mjs";
import { assemble } from "../src/build/assemble.mjs";
import { makeProgress } from "../src/scan/progress.mjs";
import { starterConfig } from "../src/config/init.mjs";

// Draws nothing unless stderr is a terminal, so a redirect or a pipe is
// untouched and the pipeline never has to know which it is.
const progress = makeProgress(process.stderr);
const warn = (...m) => {
  progress.clear();
  process.stderr.write(m.join(" ") + "\n");
};
const die = (msg) => {
  warn(`fatal: ${msg}`);
  process.exit(1);
};

const USAGE = `atlas <command> [options]

  build      scan a repository and write a self-contained HTML atlas
  scan       what the scanner found, and what it could not
  init       write a starter config by inspecting the repo
  findings   cycles, layering violations, orphans          (phase 5)
  serve      local viewer with source reading              (phase 7)

options
  --repo PATH      repository to scan            (default: .)
  --config FILE    config module                 (optional: detected otherwise)
  --ref REF        git ref, or \`worktree\` / \`fs\`  (default: HEAD)
  --out FILE       output html                   (default: atlas.html)
  --json           print the payload, write no HTML
  --no-fetch       skip \`git fetch origin\` for an origin/* ref
  --strict         fail, instead of warning, on stale curated flows
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: "string", default: "." },
    config: { type: "string" },
    ref: { type: "string", default: "HEAD" },
    out: { type: "string", default: "atlas.html" },
    json: { type: "boolean", default: false },
    "no-fetch": { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const command = positionals[0];
if (values.help || !command) {
  process.stdout.write(USAGE);
  process.exit(command ? 0 : 1);
}

const PENDING = { findings: 5, serve: 7 };
if (PENDING[command]) die(`\`atlas ${command}\` lands in phase ${PENDING[command]}`);
if (!["build", "scan", "init"].includes(command)) die(`unknown command "${command}"\n\n${USAGE}`);

// No config means defaults plus detection, which is the path a repository the
// tool has never seen takes. A config only ever overrides what it names.
const repo = path.resolve(values.repo);

// The one command that writes to a target repository, and it writes one file it
// has never seen before: an existing config was written or edited by a person,
// and no amount of detection is worth overwriting that.
if (command === "init") {
  const file = path.join(repo, "atlas.config.mjs");
  if (existsSync(file)) die(`${file} already exists — delete it first, or edit it in place`);
  const { text, services, fileCount } = starterConfig(repo);
  writeFileSync(file, text);
  warn(`atlas: wrote ${file}`);
  warn(`atlas: ${services.length} service(s) detected over ${fileCount} files -> ${services.map((s) => s.id).join(", ")}`);
  process.exit(0);
}
const config = values.config
  ? (await import(pathToFileURL(path.resolve(values.config)).href)).default
  : undefined;

let result;
try {
  result = scan({
    repo,
    ref: values.ref,
    config,
    fetch: !values["no-fetch"],
    // A generic tool cannot hard-exit on somebody else's stale curated flow.
    strict: values.strict,
    warn,
    progress,
  });
} catch (e) {
  progress.done();
  die(e.message);
}
progress.done();

const { payload, diagnostics } = result;

// The report is a by-product of `build` and the whole point of `scan`, so it
// follows the same rule every other tool does: a command's output goes to
// stdout, a command's commentary goes to stderr.
if (command === "scan") {
  diagnose(payload, diagnostics, (...m) => process.stdout.write(m.join(" ") + "\n"));
  process.exit(0);
}

report(payload, diagnostics, warn);

if (values.json) {
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const out = path.resolve(values.out);
writeFileSync(out, assemble(payload));
warn(`atlas: wrote ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
