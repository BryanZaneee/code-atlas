/**
 * Module load sweep. Not import EXTRACTION -- that is conformance.test.mjs.
 *
 * Every other test in this suite reaches a module by importing it directly for
 * a specific behaviour, so a module nothing exercises — a new file mid-refactor,
 * a helper only one corpus-gated test happens to pull in — can carry a syntax
 * error, a broken relative path, or a named export that silently evaluates to
 * `undefined`, and nothing notices. This does not test behaviour; it imports
 * every .mjs file under src/ and bin/ and checks what comes back.
 *
 * Discovery walks the tree (fs.readdirSync's recursive option) rather than
 * listing files by hand — a hardcoded list stops covering a file the moment
 * someone adds one, which defeats the sweep's whole point.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./helpers.mjs";

/**
 * `bin/atlas.mjs` is a CLI entrypoint: its top level parses `process.argv`,
 * calls `process.exit()` on a bad invocation, and on a valid one runs the
 * command — up to `writeFileSync` and, for `serve`, opening a socket.
 * Importing it is "run the CLI with this test runner's argv", not "load the
 * module", so it is excluded rather than guarded — there is no side-effect-free
 * way to import it.
 *
 * ponytail: excluding by relative path rather than detecting "has top-level
 * side effects" statically — the one CLI entrypoint in the tree is a known,
 * named exception, not a pattern worth a general rule.
 */
const EXCLUDED = new Set(["bin/atlas.mjs"]);

const MODULES = ["src", "bin"]
  .flatMap((root) => readdirSync(path.join(REPO_ROOT, root), { recursive: true })
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => path.join(root, f)))
  .filter((f) => !EXCLUDED.has(f));

test("the sweep found modules to check", () => {
  // A sweep over zero files passes every assertion below vacuously — the one
  // failure mode that would hide a broken discovery walk.
  assert.ok(MODULES.length > 10, `expected many .mjs files, found ${MODULES.length}`);
});

for (const rel of MODULES) {
  test(`${rel} imports cleanly, with every export defined`, async () => {
    const mod = await import(pathToFileURL(path.join(REPO_ROOT, rel)).href);
    const undef = Object.entries(mod).filter(([, v]) => v === undefined).map(([name]) => name);
    assert.deepEqual(undef, [], `${rel} exports undefined for: ${undef.join(", ")}`);
  });
}

/**
 * `src/serve/server.mjs` exports `listen()`, the one function in the tree that
 * opens a socket — everything else that writes a file or spawns a process
 * (`scan()`, `starterConfig()`, `openBrowser()`) does it from inside a function
 * body, never at module-evaluation time, so importing it is inert by
 * construction. This checks the one export where "inert" is worth verifying
 * rather than assuming: importing the module that *can* bind a port, without
 * calling the function that binds it, must leave Node's open-handle count where
 * it started.
 */
test("importing src/serve/server.mjs does not open a socket", async () => {
  const before = process._getActiveHandles().length;
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, "src/serve/server.mjs")).href);
  assert.equal(typeof mod.listen, "function");
  assert.equal(process._getActiveHandles().length, before);
});
