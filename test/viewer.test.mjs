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

/**
 * Every top-level binding a file introduces, including the ones after a comma.
 *
 * A `/^(?:const|let|var)\s+(\w+)/` regex sees only the FIRST declarator, which
 * left 14 names unchecked across the viewer — among them `ctx`, `octx`, `W`,
 * `H`, `DPR` and `BG`, precisely the short names a new file is most likely to
 * re-declare. The guard is worth more than the regex is short: these files are
 * concatenated into one script scope, so a collision is a real bug that only
 * appears once the bundle runs.
 *
 * Depth-aware rather than parsed: commas inside an initializer's parens,
 * brackets or braces are not declarator separators, and a string may contain
 * any of those characters.
 */
function topLevelNames(text) {
  const QUOTES = ['"', "'", "`"];
  const skipString = (i) => {
    const q = text[i++];
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === q) return i + 1;
      i++;
    }
    return i;
  };

  const names = [];
  for (const m of text.matchAll(/^(?:function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);

  for (const m of text.matchAll(/^(?:const|let|var)\s+/gm)) {
    let i = m.index + m[0].length, depth = 0, expectName = true, lastReal = "";
    while (i < text.length) {
      const c = text[i];
      if (QUOTES.includes(c)) { i = skipString(i); lastReal = '"'; continue; }
      if ("([{".includes(c)) { depth++; i++; lastReal = c; continue; }
      if (")]}".includes(c)) { depth--; i++; lastReal = c; continue; }
      if (depth === 0 && c === ";") break;
      // A declaration with no semicolon ends at the newline — unless the line
      // ended on `,` or `=`, which means the statement continues.
      if (depth === 0 && c === "\n" && lastReal !== "," && lastReal !== "=") break;
      if (depth === 0 && c === ",") { expectName = true; lastReal = c; i++; continue; }
      if (expectName && depth === 0 && /[A-Za-z_$]/.test(c)) {
        const id = text.slice(i).match(/^[A-Za-z_$][\w$]*/)[0];
        names.push(id);
        expectName = false;
        i += id.length;
        lastReal = "x";
        continue;
      }
      if (!/\s/.test(c)) lastReal = c;
      i++;
    }
  }
  return names;
}

/**
 * Minified vendored code defeats the walker above, and does not need it.
 *
 * A regex literal carries unbalanced brackets — `/[({]/` is three opens and no
 * close — so the depth counter loses its place partway through a minified file
 * and starts reading object keys as declarators. Minification also puts every
 * top-level declaration at the start of its own line, which is precisely the
 * case the naive one-declarator regex gets right. Vendored files are therefore
 * read with the simple rule and still contribute their names, so a viewer
 * module that re-declares one of them still fails here.
 */
const VENDORED = /^\/\*[^\n]*\bvendored:/;

function declaredNames(text) {
  if (!VENDORED.test(text)) return topLevelNames(text);
  return [...text.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
}

test("no top-level name is declared twice across viewer modules", () => {
  const owner = new Map();
  const clashes = [];
  for (const f of viewerFiles()) {
    const text = readFileSync(path.join(VIEWER_DIR, f), "utf8");
    for (const name of declaredNames(text)) {
      if (owner.has(name)) clashes.push(`${name}: ${owner.get(name)} and ${f}`);
      else owner.set(name, f);
    }
  }
  assert.deepEqual(clashes, [], `duplicate top-level names in one shared scope:\n${clashes.join("\n")}`);
});

/** The guard above must actually see a second declarator, not just the first. */
test("the duplicate-name guard sees every declarator, not only the first", () => {
  const names = topLevelNames('const a = 1, b = f(x, y), c = "s,;";\nlet d;\nfunction e() {}\n');
  assert.deepEqual(names.sort(), ["a", "b", "c", "d", "e"]);
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
  assert.ok(html.includes(`"schemaVersion":2`));
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

/**
 * A colour with two definitions eventually has two values. Everything outside
 * :root must go through a token, so the palette has exactly one home.
 */
/**
 * `:root` and its theme variants are the token-definition blocks; every other
 * rule goes through a var(). A literal outside them is a colour the dark theme
 * cannot reach, which is exactly how the old palette survived a repaint.
 */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/g;

test("style.css declares colours only in :root", () => {
  const css = readFileSync(path.join(VIEWER_DIR, "style.css"), "utf8");
  const outside = css.replace(/:root[^{]*\{[^}]*\}/g, "");
  const strays = outside.match(COLOUR) ?? [];
  assert.deepEqual(strays, [], "promote these to a custom property in :root");
});

test("every :root token has a value in both themes", () => {
  const css = readFileSync(path.join(VIEWER_DIR, "style.css"), "utf8");
  const blocks = [...css.matchAll(/:root([^{]*)\{([^}]*)\}/g)];
  const names = (body) => new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const light = names(blocks.find((b) => !b[1].trim())[2]);
  for (const b of blocks.filter((x) => x[1].trim())) {
    const missing = [...names(b[2])].filter((n) => !light.has(n));
    assert.deepEqual(missing, [], `${b[1].trim()} defines tokens the base palette does not`);
  }
});

/**
 * The tool must not know one repository's palette or view names. Both now come
 * from the payload, so a viewer that reads them from anywhere else is a bug.
 */
test("the viewer reads theme and views from the payload", () => {
  const bundle = bundleScript();
  assert.match(bundle, /THEME = ATLAS\.theme/);
  assert.match(bundle, /const VIEWS = ATLAS\.views/);
  // The legend used to repeat ten literals already present in the edge tables,
  // and the renderer carried a dozen rgba() literals the hex check never saw —
  // which is how a whole palette survived being retired.
  const literals = bundle.match(COLOUR) ?? [];
  assert.deepEqual(literals, [], `colours belong in the payload theme: ${literals.join(", ")}`);
});

test("index.html declares exactly one of each marker", () => {
  const html = readFileSync(path.join(VIEWER_DIR, "index.html"), "utf8");
  for (const marker of ["/*__ATLAS_DATA__*/", "/*__ATLAS_STYLE__*/", "/*__ATLAS_SCRIPT__*/"]) {
    assert.equal(html.split(marker).length, 2, `expected exactly one ${marker}`);
  }
});
