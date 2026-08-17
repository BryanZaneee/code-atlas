/**
 * Layer and service classification, with provenance.
 *
 * Every node records WHY it landed where it did — the rule that placed it, by
 * index and description. INSPECT shows it. That is the single cheapest thing
 * that makes a heuristic tool trustworthy: it turns "the tool put my file in
 * the wrong column" from a bug report into a config edit.
 *
 * Rules are data, not code, so a config can reorder or replace them without
 * the tool growing a branch for anybody's directory layout.
 *
 *   { layer, exts, dirs, names, nameRe, re, why }
 *
 * A rule matches if EVERY primitive it declares matches. First match wins, so
 * order is significant and is the config's to decide.
 */

/** Does one rule match this path? */
function matches(rule, p, name, segments) {
  if (rule.exts && !rule.exts.some((e) => p.endsWith(e))) return false;
  if (rule.dirs && !rule.dirs.some((d) => segments.includes(d))) return false;
  if (rule.names && !rule.names.includes(name)) return false;
  if (rule.nameRe && !rule.nameRe.test(name)) return false;
  if (rule.re && !rule.re.test(p)) return false;
  return true;
}

/** A readable reason, so provenance is useful even when a config omits `why`. */
function describe(rule) {
  if (rule.why) return rule.why;
  const parts = [];
  if (rule.exts) parts.push(`extension ${rule.exts.join("/")}`);
  if (rule.dirs) parts.push(`directory ${rule.dirs.map((d) => `${d}/`).join(" or ")}`);
  if (rule.names) parts.push(`filename ${rule.names.join(", ")}`);
  if (rule.nameRe) parts.push(`filename matching ${rule.nameRe}`);
  if (rule.re) parts.push(`path matching ${rule.re}`);
  return parts.join(" + ") || "always";
}

/**
 * Layer for a path. Total by construction: a path that matches no rule gets
 * the fallback, and says so. "Everything landed in tooling because no rule
 * matched" is a legible failure; a blank screen is not.
 */
export function classifyLayer(p, rules, fallback = "tooling") {
  const name = p.split("/").pop() ?? "";
  const segments = p.split("/").slice(0, -1);
  for (const [i, rule] of rules.entries()) {
    if (matches(rule, p, name, segments)) {
      return { layer: rule.layer, why: `matched rule #${i + 1} — ${describe(rule)}`, matched: true };
    }
  }
  // Directory-derived fallback: a directory name that IS a layer id is a better
  // guess than giving up, and it is what makes an unconfigured repo legible.
  const known = new Set(rules.map((r) => r.layer));
  const fromDir = segments.findLast((d) => known.has(d));
  if (fromDir) {
    return { layer: fromDir, why: `no rule matched — derived from directory "${fromDir}/"`, matched: false };
  }
  return { layer: fallback, why: "no rule matched, no layer-named directory", matched: false };
}

/**
 * Service for a path. **Total**: the returned id always exists in `services`.
 *
 * This is failure mode #1 in PLAN.md. The prototype returned "other" for
 * anything outside a known root, "other" was not in the services list, the
 * viewer filters by service, and every node vanished — with no checkbox left to
 * bring them back. A flat single-package repo rendered as a blank screen.
 */
export function makeServiceOf(services) {
  const roots = services
    .filter((s) => s.root)
    .map((s) => ({ id: s.id, root: s.root, prefix: s.root + "/" }))
    // Longest root first, so a nested service wins over the one containing it.
    .sort((a, b) => b.root.length - a.root.length);

  const fallback = services.find((s) => !s.root) ?? services[0];

  return (p) => {
    for (const s of roots) {
      if (p.startsWith(s.prefix)) return { service: s.id, why: `under service root ${s.root}/` };
    }
    return { service: fallback.id, why: `outside every service root — fell back to ${fallback.id}` };
  };
}
