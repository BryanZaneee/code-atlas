/**
 * Endpoint extraction.
 *
 * Rules come from config as {re, mount} pairs. A rule's mount is applied only
 * when the literal path does not already carry it, which is how a service that
 * mounts its router at a prefix and also hangs unversioned probes off the app
 * gets both right from one rule set.
 *
 * A rule's `mount` is a claim by the config and always wins. With none, the
 * prefix comes from `resolveMounts` — the chain of `app.route(prefix, router)`
 * registrations followed across files to a fixpoint, which is the only way a
 * path assembled from three files is ever right.
 *
 * The rule that never changes: a non-literal path is skipped and reported,
 * never guessed at, because a phantom endpoint is worse than a missing one.
 * Two shapes of skip exist, and both are counted rather than dropped silently:
 *   - a call a rule's receiver/method shape recognises, but whose path isn't
 *     a string literal (`router.post(somePathVar)`);
 *   - a route-shaped object literal (`{ path: "/x", ... }`) handed to a
 *     helper, in a file that is itself mounted as a router — the path is
 *     real, but the method lives in code this tool does not follow.
 * `extractEndpoints` attaches the list to the returned array as `.skips`:
 * `JSON.stringify` ignores non-index array properties, so it never joins the
 * public payload, and `diagnose()` (src/build/build.mjs) reads it back off
 * `payload.endpoints.skips` without a second return channel.
 *
 * Beyond the registration forms above, two route sources are language/
 * framework conventions rather than a repo's own layout: file-based routing
 * (Next.js App Router — a `route.ts`/`page.tsx` under a directory tree named
 * "app" IS the route) and path normalization (`:id` and `{id}` are the same
 * logical param in two frameworks' syntax, and collapse to one).
 */
import { resolveMounts } from "./mounts.mjs";
import { adapterFor } from "../adapters/index.mjs";
import { langOf } from "../scan/graph.mjs";

// Prose and data. A `.md` or `.json` file having no endpoints is not a gap in
// what this tool can read, so it is not worth reporting as one.
const NOT_CODE = new Set(["md", "json", "sql"]);

/** `/api/ai` + `/cleanup` -> `/api/ai/cleanup`, without doubling the slash. */
const joinPath = (a, b) => (a + b).replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";

/** 1-based line of a byte offset — jump-to-line (Phase 7) and skip reports. */
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** `{id}` -> `:id`, so a path is one logical node regardless of which framework's param syntax wrote it. */
const normalizePath = (p) => p.replace(/\{(\w+)\}/g, ":$1");

// The quoted-literal tail every default and config endpoint rule ends with.
// Stripping it from a rule's source turns the rule into "the call this rule's
// receiver/method shape recognises", with no requirement that the argument be
// a literal — which is exactly the shape a skip needs to be found by.
const LITERAL_TAIL = `["']([^"']+)["']`;
function callShape(rule) {
  const src = rule.re.source;
  if (!src.endsWith(LITERAL_TAIL)) return null;
  const flags = rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g";
  return new RegExp(src.slice(0, -LITERAL_TAIL.length), flags);
}

// A route-shaped object literal passed to a helper: `{ path: "/relight", ... }`.
// Legitimate anywhere a file is mounted as a router — that is what makes the
// path real — but the METHOD lives in whatever the helper does with it, which
// this tool does not follow.
const ROUTE_OBJECT = /\b(?:path|url|route)\s*:\s*["']([^"']+)["']/g;

// Next.js App Router: a `route.ts`/`page.tsx` file under a directory named
// "app" IS a route, at the path its containing directories spell out. "app"
// is the framework's own root name — like "services/" is a layer convention —
// not a particular repository's layout, so recognising it is not a special case.
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
  const rules = endpointRules.map((r) => ({ ...r, callRe: callShape(r) }));
  const endpoints = [];
  const seen = new Set();          // service|method|path — dedupe within a service
  const routeCount = new Map();    // method|path -> how many services declare it
  const skips = [];                // { file, line, reason } — never guessed, always counted
  const unscanned = new Map();     // lang -> kept files no adapter claims, so no rule ran

  // file|line already spent on a real endpoint, so a route-object skip on the
  // same line is not double-reported alongside it.
  const matchedLines = new Set();

  // Where each router file is mounted. Only consulted when a rule does not
  // declare a `mount` of its own: a config that states the prefix is stating a
  // fact about its repository, and discovery must not overrule it.
  const mounts = resolveMounts(ctx);

  const add = (method, rawPath, p, line, service) => {
    matchedLines.add(`${p}|${line}`);
    const path = rawPath || "/";
    // `path` stays exactly what the source declared — the payload documents
    // it as literal, and a curated flow references it by that literal text.
    // Only the dedupe/collision key is normalized, so `:id` and `{id}` still
    // collapse onto one node without rewriting what either framework wrote.
    const norm = normalizePath(path);
    const key = `${service}|${method}|${norm}`;
    if (seen.has(key)) return;
    seen.add(key);
    const route = `${method}|${norm}`;
    routeCount.set(route, (routeCount.get(route) ?? 0) + 1);
    endpoints.push({ id: `${method} ${path}`, method, path, service, definedIn: p, line });
  };

  for (const p of ctx.paths) {
    if (layerOf(p).layer === "test") continue;
    // Which files a registration rule may be run over is an ADAPTER question,
    // not a hardcoded extension list: an adapter claiming a language is this
    // tool saying it can read that language as code. This used to be
    // `/\.(ts|py)$/`, which silently excluded every `.js`/`.jsx`/`.mjs` file
    // even though the ts adapter already owns them and the default rules match
    // `router.get("/x")` in plain JavaScript exactly as they do in TypeScript —
    // so an Express-in-JavaScript repo reported zero endpoints, zero derived
    // paths, and nothing in `atlas scan` to say why.
    //
    // A file with no adapter is still counted below rather than dropped in
    // silence, because "we do not read this language" and "this language has
    // no routes" look identical from the outside and only one of them is a
    // fact about the repository.
    if (!adapterFor(p)) {
      if (!NOT_CODE.has(langOf(p))) unscanned.set(langOf(p), (unscanned.get(langOf(p)) ?? 0) + 1);
      continue;
    }
    const text = ctx.src.get(p);
    const { service } = serviceOf(p);

    for (const rule of rules) {
      for (const m of text.matchAll(rule.re)) {
        const raw = m[2];
        const line = lineOf(text, m.index);
        // A rule's own mount wins; otherwise every prefix this file is
        // actually mounted under, which is how a two-level router chain gets
        // the path that is really served.
        const prefixes = rule.mount != null ? [rule.mount] : [...(mounts.get(p) ?? [""])].sort();
        for (const prefix of prefixes) {
          const full = raw.startsWith(prefix) ? raw : joinPath(prefix, raw);
          add(m[1].toUpperCase(), full, p, line, service);
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

    // A file mounted as a router that hands literal paths to a helper: the
    // path is real, but the method lives in code this tool does not follow.
    if (mounts.has(p)) {
      for (const m of text.matchAll(ROUTE_OBJECT)) {
        const line = lineOf(text, m.index);
        if (matchedLines.has(`${p}|${line}`)) continue;
        skips.push({ file: p, line, reason: "literal path, method not visible (helper-registered)" });
      }
    }
  }

  // File-based routing runs independently of the mount chain — the directory
  // tree IS the path, and there is nothing to resolve.
  for (const p of ctx.paths) {
    const base = p.split("/").pop();
    if (!ROUTE_FILE.test(base) || layerOf(p).layer === "test") continue;
    const url = fileRouteUrl(p);
    if (url == null) continue;
    const { service } = serviceOf(p);

    if (base.startsWith("page.")) {
      add("GET", url, p, 1, service);
      continue;
    }
    const text = ctx.src.get(p);
    for (const m of text.matchAll(METHOD_EXPORT)) {
      add(m[1] ?? m[2], url, p, lineOf(text, m.index), service);
    }
    // A route.ts with no recognised HTTP export is not guessed at or reported
    // as a skip: it is not a registration this tool saw and could not
    // resolve, just an unusual file — a different thing entirely.
  }

  // Two services can expose the same probe path. Keep the bare id where a
  // path is unique so curated flows stay readable, and qualify only real
  // collisions.
  for (const e of endpoints) {
    if (routeCount.get(`${e.method}|${normalizePath(e.path)}`) > 1) {
      e.id = `${e.method} ${e.path} · ${e.service}`;
    }
  }

  endpoints.skips = skips;
  // Languages this tool keeps and counts but has no adapter for, so no
  // registration rule was ever run over them. Rides along the same way `skips`
  // does, and for the same reason: it is a fact about coverage, not payload.
  endpoints.unscanned = [...unscanned].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return endpoints;
}
