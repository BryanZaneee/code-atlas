/** Layer and service classification. Rules are data `{layer, exts, dirs, names, nameRe, re, why}`; every primitive must match, first match wins. */

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

/** Layer for a path. Total: an unmatched path gets the fallback, and says so. */
export function classifyLayer(p, rules, fallback = "tooling") {
  const name = p.split("/").pop() ?? "";
  const segments = p.split("/").slice(0, -1);
  for (const [i, rule] of rules.entries()) {
    if (matches(rule, p, name, segments)) {
      return { layer: rule.layer, why: `matched rule #${i + 1} — ${describe(rule)}`, matched: true };
    }
  }
  // A directory named after a layer id beats giving up; it is what makes an unconfigured repo legible.
  const known = new Set(rules.map((r) => r.layer));
  const fromDir = segments.findLast((d) => known.has(d));
  if (fromDir) {
    return { layer: fromDir, why: `no rule matched — derived from directory "${fromDir}/"`, matched: false };
  }
  return { layer: fallback, why: "no rule matched, no layer-named directory", matched: false };
}

/** Service for a path. Total: the returned id always exists in `services`, or the viewer filters every node away. */
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

/** Declare any service id a custom `serviceOf` used but never listed, so its files keep a checkbox instead of vanishing. */
export function reconcileServices(services, nodes, warn = () => {}) {
  const known = new Set(services.map((s) => s.id));
  const missing = [...new Set(nodes.map((n) => n.service).filter((s) => s && !known.has(s)))];
  if (!missing.length) return services;

  warn(`warn: ${missing.length} service id(s) used but never declared (${missing.join(", ")}) — added, or their files would be invisible`);
  return [
    ...services,
    ...missing.map((id, i) => ({
      id,
      label: id.toUpperCase().replace(/[-_]/g, " "),
      lang: "-",
      root: null,
      order: services.length + i,
      synthesized: true,
    })),
  ];
}
