/**
 * Endpoint extraction.
 *
 * Rules come from config as {re, mount} pairs. A rule's mount is applied only
 * when the literal path does not already carry it, which is how a service that
 * mounts its router at a prefix and also hangs unversioned probes off the app
 * gets both right from one rule set.
 *
 * Phase 4 replaces this with symbol -> file mount resolution run to a fixpoint,
 * file-based routing, and a count of the non-literal registrations skipped. The
 * rule that never changes: a non-literal path is skipped and reported, never
 * guessed at, because a phantom endpoint is worse than a missing one.
 */
export function extractEndpoints(ctx) {
  const { endpointRules = [], layerOf, serviceOf } = ctx.config;
  const endpoints = [];
  const seen = new Set();          // service|method|path — dedupe within a service
  const routeCount = new Map();    // method|path -> how many services declare it

  for (const p of ctx.paths) {
    if (!/\.(ts|py)$/.test(p) || layerOf(p).layer === "test") continue;
    for (const { re, mount } of endpointRules) {
      for (const m of ctx.src.get(p).matchAll(re)) {
        const raw = m[2];
        const full = raw.startsWith(mount) ? raw : mount + raw;
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

  // Two services can expose the same probe path. Keep the bare id where a path
  // is unique so curated flows stay readable, and qualify only real collisions.
  for (const e of endpoints) {
    if (routeCount.get(`${e.method}|${e.path}`) > 1) {
      e.id = `${e.method} ${e.path} · ${e.service}`;
    }
  }

  return endpoints;
}
