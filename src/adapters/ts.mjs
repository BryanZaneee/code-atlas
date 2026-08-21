/**
 * TypeScript / JavaScript adapter.
 *
 * `resolve` returns an ARRAY of ids: one specifier can name many files in other
 * languages (Go packages, Java wildcards), and a re-export barrel does the same
 * here, so the shape is an array everywhere rather than a special case.
 *
 * Extensions cover the whole ecosystem, not just `.ts`: a `.jsx` or `.mjs` file
 * is source the same as a `.ts` one, and leaving it unclaimed means the adapter
 * silently extracts nothing from it. `adapterFor` picks the first adapter whose
 * extensions match, so this is the only place that decision is made.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { withLines } from "./lex.mjs";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// A NodeNext/ESM import names the extension its own compiled output would
// have; the source living next to it is almost always TypeScript. Tried
// before the literal specifier so `./x.js` prefers `x.ts` when both exist.
const SWAP_EXT = { ".js": ".ts", ".jsx": ".tsx", ".mjs": ".ts", ".cjs": ".ts" };

// `from "x"` covers every static form that carries one: default, named,
// namespace, side-effect-with-bindings, and `export … from`/`export * from`,
// which are re-exports and therefore edges too. No line anchor: a multi-line
// import's `from` clause can sit several lines below `import {`.
const FROM = /\bfrom\s*["']([^"']+)["']/g;
// A bare side-effect import has no `from` clause at all, so it needs its own
// pattern — and it must not fire on `import {` or `import(`, which the
// required quote-after-optional-whitespace shape already excludes.
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const REQUIRE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Blank comments and template-literal bodies before extraction, so a fake
 * specifier in a `//` note or a backtick string never matches an import
 * pattern. Ordinary `'…'`/`"…"` strings are left untouched — that is where a
 * real specifier lives, and the walk keeps their contents intact deliberately.
 * A single left-to-right scan (not a regex) so a string containing `//` or
 * `/*` is never mistaken for the start of a comment; length and newlines are
 * preserved so a match's offset still lines up with the original text.
 *
 * Known miss: a regex literal containing `/*` (`/[/*]/`) reads as a comment
 * opening to this scanner, same as a real one would. That blanks too much
 * rather than too little — under-reporting, not a phantom import — so it is
 * left as the accepted cost rather than special-cased.
 */
function blank(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && text[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && c2 === "*") {
      out += "  "; i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { out += text[i] === "\n" ? "\n" : " "; i++; }
      if (i < n) { out += "  "; i += 2; }
    } else if (c === "`") {
      out += "`"; i++;
      while (i < n && text[i] !== "`") {
        if (text[i] === "\\") { out += "  "; i += 2; continue; }
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) { out += "`"; i++; }
    } else if (c === '"' || c === "'") {
      const quote = c;
      out += c; i++;
      while (i < n && text[i] !== quote && text[i] !== "\n") {
        if (text[i] === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
        out += text[i]; i++;
      }
      if (i < n && text[i] === quote) { out += quote; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}


/**
 * `tsconfig.json` allows `//`/`/* *\/` comments and a trailing comma, neither
 * of which `JSON.parse` accepts. Comments are stripped with the same
 * string-aware scan as source blanking (minus template literals, which JSON
 * does not have); the trailing comma is a single pass afterward since by then
 * every remaining comma sits outside a string.
 */
function parseJsonc(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], c2 = text[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"') {
      out += c; i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
        out += text[i]; i++;
      }
      out += text[i] ?? ""; i++;
    } else {
      out += c; i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** `.` for the repo root, never a leading `./` or trailing `/`. */
function normDir(p) {
  const n = path.posix.normalize(p);
  return n === "." ? "" : n.replace(/\/$/, "");
}

/**
 * Every candidate a bare or extensionless specifier could name, in the order
 * they are tried. Extension swap first (the common NodeNext case), then the
 * literal path, then each extension appended, then each extension's `/index`.
 */
function candidatesFor(base) {
  const out = [];
  const ext = EXTENSIONS.find((e) => base.endsWith(e));
  if (ext && SWAP_EXT[ext]) out.push(base.slice(0, -ext.length) + SWAP_EXT[ext]);
  out.push(base);
  for (const e of EXTENSIONS) out.push(base + e);
  for (const e of EXTENSIONS) out.push(`${base}/index${e}`);
  return out;
}

function tryResolveFile(base, ctx) {
  for (const c of candidatesFor(base)) if (ctx.fileSet.has(c)) return c;
  return null;
}

/**
 * `paths` entries carry at most one `*`; the longest literal prefix wins when
 * more than one pattern could match, which is how TypeScript itself picks
 * among overlapping patterns. Returns the target templates with `*`
 * substituted, still relative to the owning tsconfig's effective `baseUrl`.
 */
function matchAlias(spec, paths) {
  const keys = Object.keys(paths).sort((a, b) => b.replace("*", "").length - a.replace("*", "").length);
  for (const key of keys) {
    if (!key.includes("*")) {
      if (spec === key) return paths[key];
      continue;
    }
    const star = key.indexOf("*");
    const prefix = key.slice(0, star), suffix = key.slice(star + 1);
    if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length) {
      const captured = spec.slice(prefix.length, spec.length - suffix.length);
      return paths[key].map((t) => t.replace("*", captured));
    }
  }
  return null;
}

/** The tsconfig that governs a file: the nearest one at or above it. */
function nearestTsconfig(from, configs) {
  return configs.find((c) => c.dir === "" || from === c.dir || from.startsWith(c.dir + "/")) ?? null;
}

/**
 * Imported specifiers with the local names they bind. Path derivation uses
 * this to tell which of a route file's many imports one endpoint actually
 * touches, so the first hop is not the whole import list.
 */
function importBindings(text) {
  const clean = blank(text);
  const out = [];
  const NAMED = /\bimport\s+(?:type\s+)?(?:(\w+)\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of clean.matchAll(NAMED)) {
    const localNames = new Set(m[1] ? [m[1]] : []);
    for (const part of m[2].split(",")) {
      const s = part.trim().replace(/^type\s+/, "");
      if (!s) continue;
      const bits = s.split(/\s+as\s+/);
      localNames.add((bits[1] ?? bits[0]).trim());
    }
    out.push({ spec: m[3], localNames });
  }
  const NAMESPACE = /\bimport\s+\*\s+as\s+(\w+)\s*from\s*["']([^"']+)["']/g;
  for (const m of clean.matchAll(NAMESPACE)) out.push({ spec: m[2], localNames: new Set([m[1]]) });
  const DEFAULT_ONLY = /\bimport\s+(\w+)\s*from\s*["']([^"']+)["']/g;
  for (const m of clean.matchAll(DEFAULT_ONLY)) out.push({ spec: m[2], localNames: new Set([m[1]]) });
  const REQ = /\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of clean.matchAll(REQ)) out.push({ spec: m[2], localNames: new Set([m[1]]) });
  const REQ_DESTRUCT = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of clean.matchAll(REQ_DESTRUCT)) {
    const localNames = new Set();
    for (const part of m[1].split(",")) {
      const s = part.trim();
      if (!s) continue;
      const bits = s.split(":").map((x) => x.trim());
      localNames.add(bits[1] ?? bits[0]);
    }
    out.push({ spec: m[2], localNames });
  }
  return out;
}

export default {
  id: "ts",
  extensions: EXTENSIONS,
  blankComments: blank,
  importBindings,

  /** The source file a test conventionally covers: test/x.test.ts -> src/x.ts. */
  testSubject: (p) => p.replace("/test/", "/src/").replace(/\.test\.ts$/, ".ts"),

  /**
   * `paths`/`baseUrl` are scoped per tsconfig, not repo-wide: a monorepo
   * routinely has one workspace with an alias and a sibling with none, and a
   * file in the second must not inherit the first's table. Read once here
   * rather than per import, and from `ctx.dir` directly — `tsconfig.json`
   * carries no import edges of its own, so `keep` never admits it into `src`.
   */
  prepare(ctx) {
    const configs = [];
    for (const p of ctx.all ?? []) {
      if (path.posix.basename(p) !== "tsconfig.json") continue;
      let json;
      try {
        json = parseJsonc(readFileSync(path.join(ctx.dir, p), "utf8"));
      } catch {
        continue; // malformed or unreadable: files under it still resolve, just with no alias help
      }
      const co = json?.compilerOptions ?? {};
      const dir = normDir(path.posix.dirname(p));
      // `baseUrl` is null unless the tsconfig actually declares one — that is
      // what TypeScript's own resolver keys on to decide whether a bare
      // specifier can mean a project file at all, rather than node_modules.
      // `co.baseUrl` may normalise to `""` at the repo root, so this checks
      // for the key rather than truthiness.
      const baseUrl = co.baseUrl != null ? normDir(path.posix.join(dir, co.baseUrl)) : null;
      configs.push({ dir, baseUrl, paths: co.paths ?? null });
    }
    // Longest directory first, so the nearest ancestor is the first match
    // `nearestTsconfig` finds rather than the outermost one.
    configs.sort((a, b) => b.dir.length - a.dir.length);
    return { configs };
  },

  extractImports(text) {
    const blanked = blank(text);
    const matches = [];
    for (const m of blanked.matchAll(FROM)) matches.push({ index: m.index, spec: m[1], kind: "static" });
    for (const m of blanked.matchAll(BARE_IMPORT)) matches.push({ index: m.index, spec: m[1], kind: "static" });
    for (const m of blanked.matchAll(REQUIRE)) matches.push({ index: m.index, spec: m[1], kind: "require" });
    for (const m of blanked.matchAll(DYNAMIC_IMPORT)) matches.push({ index: m.index, spec: m[1], kind: "dynamic" });
    return withLines(text, matches);
  },

  resolve(from, spec, ctx) {
    const cfg = nearestTsconfig(from, ctx.ts?.configs ?? []);

    // TypeScript never applies `paths` to a relative specifier — only to a
    // bare one. Checking this first, ahead of the dot-prefix branch below,
    // would let a catch-all pattern like `"*": ["./src/*"]` capture `./foo`
    // and resolve it against src/ instead of against the importing file.
    if (cfg?.paths && !spec.startsWith(".")) {
      const targets = matchAlias(spec, cfg.paths);
      if (targets) {
        // `paths` without a declared `baseUrl` resolves relative to the
        // tsconfig's own directory (TS >= 4.1) — the real-repo shape this
        // adapter already targets, so the fallback is `dir`, not a bare `""`.
        const base = cfg.baseUrl ?? cfg.dir;
        const ids = [];
        for (const t of targets) {
          const hit = tryResolveFile(normDir(path.posix.join(base, t)), ctx);
          if (hit) ids.push(hit);
        }
        if (ids.length) return { kind: "internal", ids: [...new Set(ids)].sort() };
        // The alias pattern matched but named no file the walk found — a
        // config or a generated file, never a third-party package.
        return { kind: "unresolved", ids: [spec] };
      }
    }

    if (spec.startsWith(".")) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
      const hit = tryResolveFile(base, ctx);
      if (hit) return { kind: "internal", ids: [hit] };
      return { kind: "unresolved", ids: [base] };
    }

    // A bare specifier only resolves against a project directory when the
    // tsconfig actually DECLARES a `baseUrl` — with none, TypeScript sends it
    // straight to node_modules, so a file that happens to share a package's
    // name must not fabricate an internal edge. `cfg.dir` is deliberately not
    // a fallback here: that's the `paths`-without-`baseUrl` rule above, which
    // only applies once a `paths` pattern already matched.
    if (cfg?.baseUrl != null) {
      const hit = tryResolveFile(normDir(path.posix.join(cfg.baseUrl, spec)), ctx);
      if (hit) return { kind: "internal", ids: [hit] };
    }

    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    return { kind: "external", ids: [pkg] };
  },
};
