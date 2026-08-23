/**
 * Ruby.
 *
 * Two resolution modes, the same shape Python has, which is why `py.mjs` is the
 * adapter this one copies rather than `ts.mjs`:
 *
 *   `require_relative "x"`  resolves against the requiring FILE's directory
 *   `require "x"`           resolves against a load path
 *
 * The load path is the part that has to be inferred rather than read. Ruby's
 * real `$LOAD_PATH` is assembled at runtime by a gemspec, a Gemfile, `-I` flags
 * and `Bundler.setup`, none of which can be known statically. What is
 * conventional is `lib/` and `app/`'s immediate subdirectories, and Rails puts
 * every one of those on the path — so those are inferred, and a `require` that
 * names anything else is a gem, which is external.
 *
 * The under-report this accepts: a project with a hand-rolled `$LOAD_PATH` push
 * has those requires come back external rather than internal. It is counted and
 * reported by `atlas scan`, which is the standing trade rather than a new one.
 */
import path from "node:path";
import { withLines } from "./lex.mjs";

/** `# ...` to end of line, `=begin`/`=end` block comments, and both quote styles. Heredocs are deliberately not tracked: an unterminated one would blank the rest of the file, and a missed require under-reports where a wrong one invents an edge. */
function blank(text) {
  const n = text.length;
  let out = "";
  let i = 0;
  let bol = true;   // at the start of a line, which is the only place =begin counts
  while (i < n) {
    const c = text[i];
    if (bol && text.startsWith("=begin", i)) {
      const end = text.indexOf("\n=end", i);
      const stop = end === -1 ? n : Math.min(n, text.indexOf("\n", end + 1) === -1 ? n : text.indexOf("\n", end + 1));
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      bol = false;
      continue;
    }
    if (c === "#") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += " ".repeat(stop - i);
      i = stop;
      bol = false;
      continue;
    }
    if (c === '"' || c === "'") {
      // Kept, not blanked: the specifier lives inside it.
      const q = c;
      out += q; i++;
      while (i < n && text[i] !== q && text[i] !== "\n") {
        if (text[i] === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
        out += text[i]; i++;
      }
      if (i < n && text[i] === q) { out += q; i++; }
      bol = false;
      continue;
    }
    out += c;
    bol = c === "\n";
    i++;
  }
  return out;
}

/**
 * A require is a statement, so it has to start a line.
 *
 * Without the anchor, `TEMPLATE = 'require "x"'` extracts a gem that does not
 * exist — and a phantom edge is worse than a missed one, which is the whole
 * shape of the regex-not-AST trade. The cost is a `require` buried mid-line
 * inside an expression, which under-reports and is counted.
 */
const REQUIRE = /^[ \t]*(?:\w+[ \t]*=[ \t]*)?require(_relative)?[ \t]*\(?[ \t]*["']([^"'\n]+)["']/gm;

/** `lib/`, `app/`'s immediate subdirectories, and the repo root — the directories Ruby projects conventionally put on the load path. Longest first, so the most specific claims a name. */
function inferRoots(ctx) {
  const roots = new Set();
  for (const p of ctx.paths) {
    if (p.startsWith("lib/") || p === "lib") roots.add("lib");
    const m = p.match(/^(app\/[^/]+)\//);
    if (m) roots.add(m[1]);
  }
  // Only when something actually sits at the top level, so an empty root cannot claim every gem name.
  if (ctx.paths.some((p) => p.endsWith(".rb") && !p.includes("/"))) roots.add("");
  return [...roots].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** A require names a path without its extension; Ruby tries `.rb` and would try a native extension we have no business guessing at. */
const fileFor = (stem, ctx) => (ctx.fileSet.has(`${stem}.rb`) ? `${stem}.rb` : ctx.fileSet.has(stem) ? stem : null);

function specs(text) {
  const clean = blank(text);
  const matches = [];
  for (const m of clean.matchAll(REQUIRE)) {
    // `require_relative "helper"` and `require "helper"` are the same six characters and mean different things, so the relativity is normalised onto the specifier the way py.mjs carries it in leading dots. `resolve` then needs nothing but the string.
    const rel = Boolean(m[1]);
    const spec = rel && !m[2].startsWith(".") ? `./${m[2]}` : m[2];
    matches.push({ index: m.index, spec, kind: rel ? "relative" : "static" });
  }
  return matches;
}

export default {
  id: "rb",
  extensions: [".rb"],   // and not .rake: `keep` never walks one, and an adapter claiming an extension the walk drops is a quiet lie
  blankComments: blank,

  /** A require binds no local name in Ruby — it defines constants at the top level. The specifier's last segment is the closest thing to one, and it is what a reader would name. */
  importBindings(text) {
    return specs(text).map(({ spec }) => ({ spec, localNames: new Set([spec.split("/").pop()]) }));
  },

  /** RSpec beside Minitest: spec/x_spec.rb and test/x_test.rb both cover lib/x.rb. */
  testSubject: (p) =>
    p.replace(/^spec\//, "lib/").replace(/^test\//, "lib/").replace(/_(spec|test)\.rb$/, ".rb"),

  prepare(ctx) {
    return { roots: inferRoots(ctx) };
  },

  extractImports(text) {
    return withLines(text, specs(text));
  },

  resolve(from, spec, ctx) {
    // `require_relative` is always this repo or nothing: it can never mean a gem.
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
      const hit = fileFor(base, ctx);
      return hit ? { kind: "internal", ids: [hit] } : { kind: "unresolved", ids: [base] };
    }
    for (const root of ctx.rb?.roots ?? []) {
      const hit = fileFor([root, spec].filter(Boolean).join("/"), ctx);
      if (hit) return { kind: "internal", ids: [hit] };
    }
    // Not under any inferred root: a gem, named by its first segment the way a package is elsewhere.
    return { kind: "external", ids: [spec.split("/")[0]] };
  },
};
