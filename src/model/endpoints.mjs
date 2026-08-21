/** Endpoint extraction from config `{re, mount}` rules, the mount chain, and file-based routing. A non-literal path is skipped and counted, never guessed; skips ride on the returned array as `.skips`, outside the JSON payload. */
import { resolveMounts, joinPath } from "./mounts.mjs";
import { adapterFor } from "../adapters/index.mjs";
import { langOf } from "./graph.mjs";

// Prose and data: having no endpoints is not a coverage gap worth reporting.
const NOT_CODE = new Set(["md", "json", "sql"]);


/** 1-based line of a byte offset — jump-to-line (Phase 7) and skip reports. */
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** `{id}` -> `:id`, so a path is one logical node regardless of which framework's param syntax wrote it. */
const normalizePath = (p) => p.replace(/\{(\w+)\}/g, ":$1");

/** `const orders = Router()` / `= express.Router()` — the file naming a router. */
const ROUTER_DECL = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:(\w+)\s*\.\s*)?Router\s*\(/g;

/** The same name later pointed at something that is not a Router. */
const reassigned = (name) =>
  new RegExp(`\\b${name}\\s*=\\s*(?!\\s*(?:\\w+\\s*\\.\\s*)?Router\\s*\\()`);

/** Where Router came from. Matches no quotes: this runs over text with string literals blanked. */
const ROUTER_IMPORT = /\bimport\s[^;\n]*\bRouter\b[^;\n]*\bfrom\b|\brequire\s*\(/;

/** The routers a file declares, by name, read from source with comments and strings blanked so a commented-out or reassigned declaration cannot seed a phantom endpoint. */
function declaredRouters(adapter, text) {
  const code = adapter.blankComments(text).replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => " ".repeat(m.length));
  const names = [];
  for (const m of code.matchAll(ROUTER_DECL)) {
    const [, name, receiver] = m;
    if (/(?:router|app|server)$/i.test(name)) continue;   // the default rules already have it
    if (!receiver && !ROUTER_IMPORT.test(code)) continue;  // a bare Router() nobody imported
    if (reassigned(name).test(code.slice(m.index + m[0].length))) continue;
    names.push(name);
  }
  return [...new Set(names)];
}

// Strip a rule's quoted-literal tail to get the call shape a non-literal skip is found by.
const LITERAL_TAIL = `["']([^"']+)["']`;
function callShape(rule) {
  const src = rule.re.source;
  if (!src.endsWith(LITERAL_TAIL)) return null;
  const flags = rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g";
  return new RegExp(src.slice(0, -LITERAL_TAIL.length), flags);
}

// A route-shaped object literal handed to a helper: the path is real, the method is not visible.
const ROUTE_OBJECT = /\b(?:path|url|route)\s*:\s*["']([^"']+)["']/g;

// App Router: a route/page file under an "app" tree IS a route, at the path its directories spell out.
const ROUTE_FILE = /^(route|page)\.(ts|tsx|js|jsx|mjs)$/;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const METHOD_EXPORT = new RegExp(
  `export\\s+(?:async\\s+)?function\\s+(${HTTP_METHODS.join("|")})\\b|export\\s+const\\s+(${HTTP_METHODS.join("|")})\\s*=`,
  "g",
);

/** A directory segment's URL contribution, or null when it contributes none. */
function segmentFor(seg) {
  if (/^\(.*\)$/.test(seg)) return null; // a route group: organisational, not a URL segment
  const catchAll = seg.match(/^\[+\.\.\.(\w+)\]+$/);
  if (catchAll) return `:${catchAll[1]}*`;
  const dynamic = seg.match(/^\[(\w+)\]$/);
  if (dynamic) return `:${dynamic[1]}`;
  return seg;
}

/** The URL a route.ts/page.tsx file serves, or null when it sits outside an app-router tree. */
function fileRouteUrl(p) {
  const parts = p.split("/");
  parts.pop();
  const root = parts.lastIndexOf("app");
  if (root === -1) return null;
  const segs = parts.slice(root + 1).map(segmentFor).filter((s) => s !== null);
  return "/" + segs.join("/");
}

export function extractEndpoints(ctx) {
  const { endpointRules = [], layerOf, serviceOf } = ctx.config;
  const rules = endpointRules.map((r, i) => ({ ...r, i, callRe: callShape(r) }));
  const endpoints = [];
  const seen = new Set();          // service|method|path — dedupe within a service
  const routeCount = new Map();    // method|path -> how many services declare it
  const skips = [];                // { file, line, reason }
  const unscanned = new Map();     // lang -> kept files no adapter claims, so no rule ran

  // Lines already spent on a real endpoint, so a route-object skip is not double-reported.
  const matchedLines = new Set();

  // Where each router file is mounted; consulted only when a rule declares no `mount` of its own.
  const mounts = resolveMounts(ctx);

  const add = (method, rawPath, p, line, service, why) => {
    matchedLines.add(`${p}|${line}`);
    const path = rawPath || "/";
    // `path` stays as declared; only the dedupe key is normalized, so `:id` and `{id}` still collapse.
    const norm = normalizePath(path);
    const key = `${service}|${method}|${norm}`;
    if (seen.has(key)) return;
    seen.add(key);
    const route = `${method}|${norm}`;
    routeCount.set(route, (routeCount.get(route) ?? 0) + 1);
    endpoints.push({ id: `${method} ${path}`, method, path, service, definedIn: p, line, why });
  };

  for (const p of ctx.paths) {
    if (layerOf(p).layer === "test") continue;
    // Which files rules run over is an adapter question, never an extension list; a file with no adapter is counted, not dropped.
    const adapter = adapterFor(p);
    if (!adapter) {
      if (!NOT_CODE.has(langOf(p))) unscanned.set(langOf(p), (unscanned.get(langOf(p)) ?? 0) + 1);
      continue;
    }
    // A registration inside a comment is not a route; blanking preserves offsets and leaves quoted paths intact.
    const text = adapter.blankComments(ctx.src.get(p));
    const { service } = serviceOf(p);

    // Default rules key on a router/app/server receiver, or every HTTP client becomes a phantom endpoint; `declaredRouters` widens that by evidence.
    const declared = declaredRouters(adapter, ctx.src.get(p));
    const fileRules = declared.length
      ? [...rules, ...declared.map((name) => ({
        i: `#router:${name}`,
        re: new RegExp(`\\b${name}\\s*\\.\\s*(get|post|patch|put|delete)\\s*\\(\\s*["']([^"']+)["']`, "g"),
        declared: name,
      }))]
      : rules;

    for (const rule of fileRules) {
      for (const m of text.matchAll(rule.re)) {
        const raw = m[2];
        const line = lineOf(text, m.index);
        // A rule's own mount wins; otherwise every prefix this file is mounted under.
        const prefixes = rule.mount != null ? [rule.mount] : [...(mounts.get(p) ?? [""])].sort();
        for (const prefix of prefixes) {
          const full = raw.startsWith(prefix) ? raw : joinPath(prefix, raw);
          const mountedAt = rule.mount != null
            ? `prefix "${rule.mount}" declared by the rule`
            : prefix
              ? `prefix "${prefix}" from the mount chain`
              : "no mount resolved — the path is the one this file declares";
          const why = rule.declared
            ? `${rule.declared} is declared from Router() in this file · ${mountedAt}`
            : `matched endpoint rule #${rule.i} ${rule.re.source} · ${mountedAt}`;
          add(m[1].toUpperCase(), full, p, line, service, why);
        }
      }
      if (rule.callRe) {
        for (const m of text.matchAll(rule.callRe)) {
          const after = text[m.index + m[0].length];
          if (after === '"' || after === "'") continue; // a literal here — the rule above already caught it
          skips.push({ file: p, line: lineOf(text, m.index), reason: "non-literal path" });
        }
      }
    }

    // A mounted router handing literal paths to a helper: real path, method not followable.
    if (mounts.has(p)) {
      for (const m of text.matchAll(ROUTE_OBJECT)) {
        const line = lineOf(text, m.index);
        if (matchedLines.has(`${p}|${line}`)) continue;
        skips.push({ file: p, line, reason: "literal path, method not visible (helper-registered)" });
      }
    }
  }

  // File-based routing ignores the mount chain: the directory tree is the path.
  for (const p of ctx.paths) {
    const base = p.split("/").pop();
    if (!ROUTE_FILE.test(base) || layerOf(p).layer === "test") continue;
    const url = fileRouteUrl(p);
    if (url == null) continue;
    const { service } = serviceOf(p);

    if (base.startsWith("page.")) {
      add("GET", url, p, 1, service, `file-based route — an app-router page under ${p.split("/").slice(0, -1).join("/")}`);
      continue;
    }
    const fileAdapter = adapterFor(p);
    if (!fileAdapter) continue;
    const text = fileAdapter.blankComments(ctx.src.get(p));
    for (const m of text.matchAll(METHOD_EXPORT)) {
      const method = m[1] ?? m[2];
      add(method, url, p, lineOf(text, m.index), service, `file-based route — ${method} exported from an app-router route file`);
    }
    // No recognised HTTP export is an unusual file, not a skip: nothing was seen and unresolved.
  }

  // Qualify only real cross-service collisions, so unique paths keep a readable bare id.
  for (const e of endpoints) {
    if (routeCount.get(`${e.method}|${normalizePath(e.path)}`) > 1) {
      e.id = `${e.method} ${e.path} · ${e.service}`;
    }
  }

  endpoints.skips = skips;
  // Kept languages with no adapter, so no rule ran: a coverage fact, carried outside the payload like `skips`.
  endpoints.unscanned = [...unscanned].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return endpoints;
}
