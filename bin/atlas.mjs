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
import { scan, report } from "../src/build/build.mjs";
import { assemble } from "../src/build/assemble.mjs";

const warn = (...m) => process.stderr.write(m.join(" ") + "\n");
const die = (msg) => {
  warn(`fatal: ${msg}`);
  process.exit(1);
};

const USAGE = `atlas <command> [options]

  build      scan a repository and write a self-contained HTML atlas
  scan       human-readable diagnostics                    (phase 2)
  init       write a starter config into a repository      (phase 2)
  findings   cycles, layering violations, orphans          (phase 5)
  serve      local viewer with source reading              (phase 7)

options
  --repo PATH      repository to scan            (default: .)
  --config FILE    config module                 (required until phase 2)
  --ref REF        git ref to scan               (default: HEAD)
  --out FILE       output html                   (default: atlas.html)
  --json           print the payload, write no HTML
  --no-fetch       skip \`git fetch origin\` for an origin/* ref
  --no-strict      warn instead of failing on stale curated flows
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
    "no-strict": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const command = positionals[0];
if (values.help || !command) {
  process.stdout.write(USAGE);
  process.exit(command ? 0 : 1);
}

const PENDING = { scan: 2, init: 2, findings: 5, serve: 7 };
if (PENDING[command]) die(`\`atlas ${command}\` lands in phase ${PENDING[command]}`);
if (command !== "build") die(`unknown command "${command}"\n\n${USAGE}`);

// Phase 2 adds defaults and detection, and this becomes optional. Until then a
// missing config is a clear error rather than a blank atlas.
if (!values.config) die("--config is required until phase 2 adds detection");

const repo = path.resolve(values.repo);
const configPath = path.resolve(values.config);
const config = (await import(pathToFileURL(configPath).href)).default;

let result;
try {
  result = scan({
    repo,
    ref: values.ref,
    config,
    fetch: !values["no-fetch"],
    strict: !values["no-strict"],
    warn,
  });
} catch (e) {
  die(e.message);
}

const { payload, diagnostics } = result;
report(payload, diagnostics, warn);

if (values.json) {
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const out = path.resolve(values.out);
writeFileSync(out, assemble(payload));
warn(`atlas: wrote ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
