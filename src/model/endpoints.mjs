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
 */
import { resolveMounts } from "./mounts.mjs";

/** `/api/ai` + `/cleanup` -> `/api/ai/cleanup`, without doubling the slash. */
const joinPath = (a, b) => (a + b).replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") || "/";
export function extractEndpoints(ctx) {
  const { endpointRules = [], layerOf, serviceOf } = ctx.config;
  const endpoints = [];
  const seen = new Set();          // service|method|path — dedupe within a service
  const routeCount = new Map();    // method|path -> how many services declare it

  // Where each router file is mounted. Only consulted when a rule does not
  // declare a `mount` of its own: a config that states the prefix is stating a
  // fact about its repository, and discovery must not overrule it.
  const mounts = resolveMounts(ctx);

  for (const p of ctx.paths) {
    if (!/\.(ts|py)$/.test(p) || layerOf(p).layer === "test") continue;
    for (const { re, mount } of endpointRules) {
      for (const m of ctx.src.get(p).matchAll(re)) {
        const raw = m[2];
        // A rule's own mount wins; otherwise every prefix this file is
        // actually mounted under, which is how a two-level router chain gets
        // the path that is really served.
        const prefixes = mount != null ? [mount] : [...(mounts.get(p) ?? [""])].sort();
        for (const prefix of prefixes) {
          const full = raw.startsWith(prefix) ? raw : joinPath(prefix, raw);
          const method = m[1].toUpperCase();
          const { service } = serviceOf(p);
          const key = `${service}|${method}|${full}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const route = `${method}|${full}`;
          routeCount.set(route, (routeCount.get(route) ?? 0) + 1);
          endpoints.push({ id: `${method} ${full}`, method, path: full, service, definedIn: p });
        }
      }
    }
  }

  // Two services can expose the same probe path. Keep the bare id where a path
  // is unique so curated flows stay readable, and qualify only real collisions.
  for (const e of endpoints) {
    if (routeCount.get(`${e.method}|${e.path}`) > 1) {
      e.id = `${e.method} ${e.path} · ${e.service}`;
    }
  }

  return endpoints;
}
