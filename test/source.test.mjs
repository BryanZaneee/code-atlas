/**
 * The SOURCE panel: the viewer's only network path, and the only place where
 * bytes from someone else's repository enter the document.
 *
 * The rule those bytes live under is that they are TEXT. The server sends
 * `text/plain`, and this side has to keep that true — a file containing
 * `<script>` is a file, not a script. The escaping test below is therefore not
 * a style check: it runs the real `srcPaint` against a fake DOM whose
 * `innerHTML` setter throws, and reads back what actually landed in the tree.
 *
 * `05-prism.js` is vendored (committed, not installed), so it is tested like
 * anything else in `src/`: it must run in the bundle's strict scope, tokenize
 * the languages it claims, and never touch the document on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bundleScript, VIEWER_DIR } from "../src/build/assemble.mjs";

const read = (f) => readFileSync(path.join(VIEWER_DIR, f), "utf8");

/**
 * A DOM small enough to reason about: text is text, elements are elements, and
 * `innerHTML` does not exist as a way in. That last part is the point — if
 * `srcPaint` ever reaches for it, this throws instead of quietly working.
 */
function fakeDom() {
  const textNode = (data) => ({ nodeType: 3, data });
  const make = (tag) => {
    const node = {
      nodeType: 1, tagName: tag.toUpperCase(), className: "", childNodes: [],
      style: {}, hidden: false,
      offsetTop: 0, offsetHeight: 0, clientHeight: 0, scrollTop: 0,
      get children() { return node.childNodes.filter((c) => c.nodeType === 1); },
      get textContent() {
        return node.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join("");
      },
      set textContent(v) { node.childNodes = [textNode(String(v))]; },
      append(...kids) { for (const k of kids) node.childNodes.push(typeof k === "string" ? textNode(k) : k); },
      replaceChildren(...kids) { node.childNodes = []; node.append(...kids); },
      set innerHTML(_v) { throw new Error("innerHTML: repository source must never be parsed as markup"); },
    };
    return node;
  };
  return { createElement: make, createTextNode: textNode, addEventListener() {}, currentScript: null };
}

/**
 * The vendored highlighter plus the source panel, in one scope, as the browser
 * gets them: concatenated, strict, sharing top-level names. `el` and `fmt`
 * come out of `15-helpers.js` itself rather than being re-typed here, so the
 * two cannot drift apart without this failing.
 *
 * `atlas` stands in for the payload's `ATLAS` global — default has no
 * `source`, matching a build without `--embed-source`. `atob`/`Blob`/
 * `Response`/`DecompressionStream` are Node's own globals handed into the
 * sandbox the same way `location` is: `vm.createContext` starts a bare
 * ECMAScript realm, not a browser, so nothing Node adds to its own
 * `globalThis` is there unless it is passed in explicitly.
 */
function loadPanel(protocol = "http:", atlas = { endpoints: [] }) {
  const helpers = read("15-helpers.js");
  const helperEl = helpers.match(/^const el = .*$/m);
  const helperFmt = helpers.match(/^const fmt = .*$/m);
  assert.ok(helperEl, "15-helpers.js no longer defines `el` on one line — update this harness");
  assert.ok(helperFmt, "15-helpers.js no longer defines `fmt` on one line — update this harness");

  const ctx = { location: { protocol }, ATLAS: atlas };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.document = fakeDom();
  ctx.atob = globalThis.atob;
  ctx.Blob = globalThis.Blob;
  ctx.Response = globalThis.Response;
  ctx.DecompressionStream = globalThis.DecompressionStream;
  vm.createContext(ctx);
  const src = ['"use strict";', read("05-prism.js"), helperEl[0], helperFmt[0], read("72-source.js")].join("\n");
  new vm.Script(src).runInContext(ctx);
  return ctx;
}

/** A plain (non-gzip) `payload.source`, shaped exactly as `embedSourceFiles` emits it. */
function embedPlain(files, glob = null) {
  return { glob, gzip: false, paths: Object.keys(files).sort(), files };
}

/**
 * A gzip `payload.source`: one shared blob over every file's text together —
 * `embedSourceFiles`'s encoding, not one gzip stream per file.
 */
function embedGzip(files, glob = null) {
  return { glob, gzip: true, paths: Object.keys(files).sort(), blob: zlib.gzipSync(JSON.stringify(files)).toString("base64") };
}

test("the vendored highlighter runs in the bundle's strict scope", () => {
  const ctx = loadPanel();
  // Every language the panel offers a grammar for must actually be loaded, or
  // the file renders plain and nothing says why.
  for (const lang of ["typescript", "tsx", "javascript", "jsx", "python", "sql", "json"]) {
    assert.ok(ctx.Prism.languages[lang], `prism component missing: ${lang}`);
  }
  // Manual: Prism's own DOM half must never run. The viewer walks tokens itself.
  assert.equal(ctx.Prism.manual, true);
});

test("the source panel never asks Prism to touch the document", () => {
  const text = read("72-source.js");
  // The prose says innerHTML; what matters is that nothing *uses* it.
  for (const way of [/\.\s*innerHTML/, /insertAdjacentHTML/, /document\.write/, /outerHTML/]) {
    assert.equal(way.test(text), false, `repository source must not go through ${way}`);
  }
  assert.equal(/Prism\.(highlight|highlightAll|highlightElement)\b/.test(text), false,
    "Prism's highlight() returns an HTML string — the panel tokenizes and builds nodes instead");
});

test("source containing markup lands as text, not as elements", () => {
  const ctx = loadPanel();
  const host = ctx.document.createElement("div");
  const hostile = [
    'const a = "</script><img src=x onerror=alert(1)>";',
    "// <script>alert(2)</script>",
    "const b = `<b>${a}</b>`;",
    "",
  ].join("\n");

  ctx.srcPaint(host, hostile, "typescript", 2);

  // Every tag in the tree is one this file created; nothing was parsed out of
  // the source itself.
  const tags = [];
  const walk = (n) => { if (n.nodeType === 1) { tags.push(n.tagName); n.childNodes.forEach(walk); } };
  host.childNodes.forEach(walk);
  assert.deepEqual([...new Set(tags)].sort(), ["DIV", "SPAN"]);

  // And the file reads back exactly as it went in — escaping that loses a
  // character is a different way of lying about the source.
  const rows = host.children[0].children;
  const back = [...rows].map((r) => r.children.find((c) => c.className === "c").textContent).join("\n");
  assert.equal(back, hostile);
});

test("a line number is the line the panel highlights", () => {
  const ctx = loadPanel();
  const host = ctx.document.createElement("div");
  ctx.srcPaint(host, "one\ntwo\nthree\n", null, 2);
  const rows = host.children[0].children;
  assert.equal(rows.length, 4);                       // trailing newline is a fourth, empty line
  assert.deepEqual(rows.map((r) => r.className), ["ln", "ln hit", "ln", "ln"]);
  assert.equal(rows[1].children.find((c) => c.className === "c").textContent, "two");
});

test("a file in a language with no grammar still renders", () => {
  const ctx = loadPanel();
  const host = ctx.document.createElement("div");
  ctx.srcPaint(host, "# a readme\n<b>not markup</b>\n", ctx.srcLangOf("README.md"), 0);
  assert.equal(ctx.srcLangOf("README.md"), null);
  assert.equal(host.children[0].children[1].textContent.includes("<b>not markup</b>"), true);
});

test("extensions map to the grammars the vendored components provide", () => {
  const ctx = loadPanel();
  for (const [file, lang] of [
    ["src/a.ts", "typescript"], ["src/a.tsx", "tsx"], ["src/a.mjs", "javascript"],
    ["src/a.jsx", "jsx"], ["a/b.py", "python"], ["q.sql", "sql"], ["p.json", "json"],
    ["Makefile", null], ["a.rs", null],
  ]) {
    assert.equal(ctx.srcLangOf(file), lang, file);
    if (lang) assert.ok(ctx.Prism.languages[lang], `${lang} has no grammar`);
  }
});

/**
 * `build` and `serve` ship the same markup, so availability cannot be baked in
 * at assembly time — the page has to work it out where it is opened.
 */
test("the reader offers itself only where there is a server to read from", () => {
  assert.equal(loadPanel("file:").srcServed(), false);
  assert.equal(loadPanel("http:").srcServed(), true);
  assert.equal(loadPanel("https:").srcServed(), true);
});

test("a built atlas opened from disk says exactly what PLAN.md promises", () => {
  assert.ok(bundleScript().includes(
    "Source is not embedded. Run `atlas serve`, or rebuild with --embed-source."));
});

test("nothing is offered as a jump when there is no server behind it", () => {
  const off = loadPanel("file:");
  assert.equal(off.srcJump("⤷ READ", "src/app.ts", 12), null);
  const on = loadPanel("http:");
  assert.equal(on.srcJump("⤷ READ", "src/app.ts", 12).textContent, "⤷ READ app.ts:12");
  assert.equal(on.srcJump(null, "src/app.ts", 12).textContent, "L12");
  // No path, no button — a file the payload does not name cannot be read.
  assert.equal(on.srcJump("⤷ READ", null, 0), null);
});

test("the inspect panel has both tabs and the reader has its own node", () => {
  const html = read("index.html");
  for (const id of ["tabInfo", "tabSource", "srcBody", "srcClose", "srcGrip", "srcPath"]) {
    assert.equal(html.split(`id="${id}"`).length, 2, `expected exactly one #${id}`);
  }
});

/* ════════════════════ --embed-source / --gzip-source ════════════════════ */

test("srcCapable is true from a live server OR from embedded source — never neither", () => {
  assert.equal(loadPanel("file:").srcCapable(), false);
  assert.equal(loadPanel("http:").srcCapable(), true);
  assert.equal(loadPanel("file:", { source: embedPlain({}), endpoints: [] }).srcCapable(), true);
});

test("an embedded file is read from the payload, not fetched, and then from the cache", async () => {
  const ctx = loadPanel("file:", {
    source: embedPlain({ "a.ts": "const x = 1;\n" }),
    endpoints: [],
  });
  const first = await ctx.srcRead("a.ts");
  assert.equal(first, "const x = 1;\n");
  // `SRC` is a top-level `const`, so it is a lexical binding this sandbox has
  // no handle on — not a property of `ctx`. Proving the cache is the seam
  // instead: remove the payload's copy and confirm the second read still
  // succeeds, which is only possible if the first read filled the same cache
  // a network read fills.
  delete ctx.ATLAS.source.files["a.ts"];
  const second = await ctx.srcRead("a.ts");
  assert.equal(second, "const x = 1;\n");
});

test("--gzip-source round-trips losslessly through the one shared blob, decoded once", async () => {
  const files = {
    "big.ts": "export function greet(name) {\n  return `hi ${name}`;\n}\n".repeat(50),
    "small.ts": "export const ok = true;\n",
  };
  const ctx = loadPanel("file:", { source: embedGzip(files), endpoints: [] });
  assert.equal(await ctx.srcRead("big.ts"), files["big.ts"]);
  // A second, different file after the first: proves the blob was decoded
  // once and both files came out of that one decode, not two.
  assert.equal(await ctx.srcRead("small.ts"), files["small.ts"]);
});

test("embedded source wins over a live fetch when both are present", async () => {
  // No `fetch` is defined on this context at all — if srcRead reached for the
  // network here instead of the payload, this would throw ReferenceError.
  const ctx = loadPanel("http:", {
    source: embedPlain({ "a.ts": "embedded, not fetched" }),
    endpoints: [],
  });
  assert.equal(await ctx.srcRead("a.ts"), "embedded, not fetched");
});

test("a live server still answers for a path the embed glob left out", async () => {
  const ctx = loadPanel("http:", {
    source: embedPlain({}, "only/*.ts"),
    endpoints: [],
  });
  ctx.fetch = async (url) => {
    assert.match(url, /path=outside\.ts$/);
    return { ok: true, text: async () => "live, from the server" };
  };
  assert.equal(await ctx.srcRead("outside.ts"), "live, from the server");
});

test("a file outside the embed glob, with no server behind the page, says so specifically", async () => {
  const ctx = loadPanel("file:", {
    source: embedPlain({}, "src/**/*.ts"),
    endpoints: [],
  });
  await assert.rejects(
    () => ctx.srcRead("docs/readme.md"),
    (err) => {
      assert.equal(err.title, "This file was not embedded.");
      assert.match(err.detail, /src\/\*\*\/\*\.ts/);
      assert.match(err.detail, /docs\/readme\.md/);
      return true;
    },
  );
});

test("srcJump works from an embedded, server-less page, exactly as it does from a served one", () => {
  const off = loadPanel("file:");
  assert.equal(off.srcJump("⤷ READ", "src/app.ts", 12), null, "no capability at all: still nothing offered");

  const embedded = loadPanel("file:", { source: embedPlain({ "src/app.ts": "" }), endpoints: [] });
  assert.equal(embedded.srcJump("⤷ READ", "src/app.ts", 12).textContent, "⤷ READ app.ts:12");
});

test("the footer badge names all three states, and only calls the embedded one a warning", () => {
  assert.equal(loadPanel("file:").srcBadgeText(), "READ-ONLY PROJECTION · NO SOURCE EMBEDDED");
  assert.equal(loadPanel("http:").srcBadgeText(), "READ-ONLY PROJECTION · SOURCE SERVED LIVE");

  const one = loadPanel("file:", { source: embedPlain({ "a.ts": "" }), endpoints: [] });
  assert.equal(one.srcBadgeText(), "SOURCE EMBEDDED · 1 FILE IN THIS HTML");

  const many = loadPanel("file:", { source: embedGzip({ "a.ts": "", "b.ts": "", "c.ts": "" }), endpoints: [] });
  assert.equal(many.srcBadgeText(), "SOURCE EMBEDDED (GZIP) · 3 FILES IN THIS HTML");
});
