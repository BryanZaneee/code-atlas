#!/usr/bin/env node
/**
 * atlas — isometric, interactive maps of a codebase.
 *
 * Read-only on the target repository: the ref is extracted with `git archive`
 * into a temp directory, so no branch is switched and no file is modified.
 * `atlas init` will be the only command permitted to write to a target repo.
 *
 *   atlas build --repo . --config atlas.config.mjs [--ref R] [--out f] [--json]
 *
 * Everything logs to stderr, so `--json` stdout is a clean payload.
 */
import { parseArgs } from "node:util";
import { writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scan, report, diagnose } from "../src/build/build.mjs";
import { assemble } from "../src/build/assemble.mjs";

const warn = (...m) => process.stderr.write(m.join(" ") + "\n");
const die = (msg) => {
  warn(`fatal: ${msg}`);
  process.exit(1);
};

const USAGE = `atlas <command> [options]

  build      scan a repository and write a self-contained HTML atlas
  scan       what the scanner found, and what it could not
  init       write a starter config into a repository      (phase 2)
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

const PENDING = { init: 2, findings: 5, serve: 7 };
if (PENDING[command]) die(`\`atlas ${command}\` lands in phase ${PENDING[command]}`);
if (command !== "build" && command !== "scan") die(`unknown command "${command}"\n\n${USAGE}`);

// No config means defaults plus detection, which is the path a repository the
// tool has never seen takes. A config only ever overrides what it names.
const repo = path.resolve(values.repo);
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
  });
} catch (e) {
  die(e.message);
}

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
