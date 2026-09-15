/** TypeScript / JavaScript adapter. `resolve` returns an array of ids because one specifier can name many files, and the extension list claims the whole ecosystem: anything left unclaimed silently yields no edges. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { withLines } from "./lex.mjs";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// A NodeNext import names its compiled output's extension; tried before the literal specifier so `./x.js` prefers `x.ts` when both exist.
const SWAP_EXT = { ".js": ".ts", ".jsx": ".tsx", ".mjs": ".ts", ".cjs": ".ts" };

// `from "x"` covers every static form, re-exports included. No line anchor: a multi-line import's `from` can sit lines below `import {`.
const FROM = /\bfrom\s*["']([^"']+)["']/g;
// A bare side-effect import has no `from` clause; the required quote-after-whitespace shape keeps it off `import {` and `import(`.
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const REQUIRE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Blank comments and template-literal bodies so a fake specifier in a note or backtick string cannot match; a left-to-right scan rather than a regex, preserving length and newlines so offsets still line up. Known miss: a regex literal containing a comment opener blanks too much, which under-reports rather than inventing an import. */
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


/** `tsconfig.json` allows comments and a trailing comma, neither of which `JSON.parse` accepts: the same string-aware scan strips comments, then one pass drops the trailing comma. */
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

/** Every candidate a bare or extensionless specifier could name, in try order: extension swap, literal path, each extension appended, then each `/index`. */
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

/** Match a specifier against `paths`, longest literal prefix first as TypeScript does, returning the target templates with `*` substituted and still relative to the effective `baseUrl`. */
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

/** Imported specifiers with the local names they bind, so path derivation can tell which import an endpoint touches instead of taking the whole list. */
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

  /** `paths`/`baseUrl` are per tsconfig, not repo-wide, so a workspace never inherits a sibling's alias table. Read from `ctx.dir` directly, since `keep` never admits `tsconfig.json` into `src`. */
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
      // Null unless declared: that is what decides whether a bare specifier can mean a project file at all. Checked by key, since `co.baseUrl` normalises to `""` at the root.
      const baseUrl = co.baseUrl != null ? normDir(path.posix.join(dir, co.baseUrl)) : null;
      configs.push({ dir, baseUrl, paths: co.paths ?? null });
    }
    // Longest directory first, so `nearestTsconfig` finds the nearest ancestor rather than the outermost.
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

    // `paths` never applies to a relative specifier: a catch-all `"*": ["./src/*"]` would otherwise capture `./foo` and resolve it against src/.
    if (cfg?.paths && !spec.startsWith(".")) {
      const targets = matchAlias(spec, cfg.paths);
      if (targets) {
        // `paths` without a declared `baseUrl` resolves against the tsconfig's own directory (TS >= 4.1), so the fallback is `dir`, not `""`.
        const base = cfg.baseUrl ?? cfg.dir;
        const ids = [];
        for (const t of targets) {
          const hit = tryResolveFile(normDir(path.posix.join(base, t)), ctx);
          if (hit) ids.push(hit);
        }
        if (ids.length) return { kind: "internal", ids: [...new Set(ids)].sort() };
        // The alias matched but named no file the walk found: a config or generated file, never a package.
        return { kind: "unresolved", ids: [spec] };
      }
    }

    if (spec.startsWith(".")) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
      const hit = tryResolveFile(base, ctx);
      if (hit) return { kind: "internal", ids: [hit] };
      return { kind: "unresolved", ids: [base] };
    }

    // A bare specifier resolves against a project directory only when a `baseUrl` is declared, or a file sharing a package's name would fabricate an internal edge. `cfg.dir` is deliberately not a fallback here.
    if (cfg?.baseUrl != null) {
      const hit = tryResolveFile(normDir(path.posix.join(cfg.baseUrl, spec)), ctx);
      if (hit) return { kind: "internal", ids: [hit] };
    }

    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    return { kind: "external", ids: [pkg] };
  },
};
