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
 * gets them: concatenated, strict, sharing top-level names. `el` comes out of
 * `15-helpers.js` itself rather than being re-typed here, so the two cannot
 * drift apart without this failing.
 */
function loadPanel(protocol = "http:") {
  const helperEl = read("15-helpers.js").match(/^const el = .*$/m);
  assert.ok(helperEl, "15-helpers.js no longer defines `el` on one line — update this harness");

  const ctx = { location: { protocol } };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.document = fakeDom();
  vm.createContext(ctx);
  const src = ['"use strict";', read("05-prism.js"), helperEl[0], read("72-source.js")].join("\n");
  new vm.Script(src).runInContext(ctx);
  return ctx;
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
