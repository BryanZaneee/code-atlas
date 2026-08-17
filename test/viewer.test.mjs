/**
 * Viewer assembly.
 *
 * The viewer's modules are concatenated into ONE script, so they share a single
 * top-level scope. That is deliberate — separate <script src> tags would work in
 * `build` and break in `serve` — but it means a duplicate top-level `const` in
 * two files is a TDZ crash at load, with a stack pointing at neither file. This
 * catches it at test time instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { viewerFiles, bundleScript, assemble, encodePayload, VIEWER_DIR } from "../src/build/assemble.mjs";
import { scanFixture } from "./helpers.mjs";

test("the concatenated bundle parses", () => {
  // Parsing is the whole check: executing it would need a DOM, and a syntax or
  // scope error is the failure mode concatenation actually introduces.
  new vm.Script(bundleScript());
});

test("no top-level name is declared twice across viewer modules", () => {
  const DECL = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  const owner = new Map();
  const clashes = [];
  for (const f of viewerFiles()) {
    const text = readFileSync(path.join(VIEWER_DIR, f), "utf8");
    for (const m of text.matchAll(DECL)) {
      const name = m[1];
      if (owner.has(name)) clashes.push(`${name}: ${owner.get(name)} and ${f}`);
      else owner.set(name, f);
    }
  }
  assert.deepEqual(clashes, [], `duplicate top-level names in one shared scope:\n${clashes.join("\n")}`);
});

test("viewer modules load in filename order", () => {
  const files = viewerFiles();
  assert.deepEqual(files, [...files].sort());
  assert.equal(files[0], "00-theme.js");
  assert.equal(files.at(-1), "90-boot.js");
});

test("assemble fills every marker", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const html = assemble(payload);
  assert.equal(html.match(/__ATLAS_(DATA|STYLE|SCRIPT)__/g), null);
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes(`"schemaVersion":1`));
});

/**
 * A path or a note containing `</script>` would otherwise close the tag and
 * turn the rest of the payload into markup; U+2028/U+2029 are legal in a JSON
 * string but terminate a line in JS source.
 */
test("payload encoding cannot break out of the script tag", () => {
  const SEP = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
  const hostile = { meta: { repo: "</script><img src=x onerror=alert(1)>" }, sep: "a" + SEP + "b" };
  const encoded = encodePayload(hostile);
  assert.ok(!encoded.includes("</script>"));
  assert.ok(!encoded.includes("<"));
  assert.ok(![...SEP].some((c) => encoded.includes(c)));
  assert.deepEqual(JSON.parse(encoded), hostile);
});

test("index.html declares exactly one of each marker", () => {
  const html = readFileSync(path.join(VIEWER_DIR, "index.html"), "utf8");
  for (const marker of ["/*__ATLAS_DATA__*/", "/*__ATLAS_STYLE__*/", "/*__ATLAS_SCRIPT__*/"]) {
    assert.equal(html.split(marker).length, 2, `expected exactly one ${marker}`);
  }
});
