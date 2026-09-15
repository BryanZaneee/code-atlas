/** What the CLI prints: `report()` to stderr, `diagnose()` to stdout. Both only read a finished payload and format it, which is why they sit beside the CLI rather than in the pipeline. */
/** `a, b, c, +N more` — a sample long enough to recognise, short enough to read. */
function sample(items, n) {
  return items.slice(0, n).join(", ") + (items.length > n ? `, +${items.length - n} more` : "");
}

/** The stderr summary. Everything logs to stderr so --json stdout stays clean. */
export function report(payload, diagnostics, warn) {
  const { stats, unclassified, orphanTests } = diagnostics;
  const m = payload.meta;
  // Which rung ran decides whether this picture is reproducible from a commit, so it leads the report.
  const a = m.acquisition;
  const at = a.commit ? `@ ${a.commit}` : "uncommitted";
  warn(`atlas: ${a.mode} ${a.ref ?? ""} ${at}${a.dirty ? " · DIRTY" : ""}`);
  warn(`atlas: ${m.fileCount} code files, ${m.lineCount} lines, ${m.edgeCount} edges, ${m.endpointCount} endpoints`);
  warn(`atlas: imports resolved=${stats.resolved} unresolved=${stats.unresolved} external=${stats.external}`);
  // The unsorted share is the honest read on classification quality: a repo no rule recognises still renders, and this is how you find that out.
  const share = m.fileCount ? Math.round((unclassified.length / m.fileCount) * 100) : 0;
  warn(`atlas: unsorted files=${unclassified.length} (${share}% — placed by fallback)${unclassified.length ? " -> " + sample(unclassified, 6) : ""}`);
  warn(`atlas: tests without a subject=${orphanTests.length}${orphanTests.length ? " -> " + orphanTests.map((n) => n.name).join(", ") : ""}`);
}

/** Count by key, most common first, capped — one helper accounts for most of any such list. */
function rankedCounts(items, keyOf) {
  const by = new Map();
  for (const it of items) by.set(keyOf(it), (by.get(keyOf(it)) ?? 0) + 1);
  return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Print a rankedCounts list, `+N more` past the cap. */
function outRanked(ranked, out, cap = 20) {
  for (const [label, n] of ranked.slice(0, cap)) out(`  ${String(n).padStart(4)} × ${label}`);
  if (ranked.length > cap) out(`  +${ranked.length - cap} more`);
}

/** `atlas scan` — the long form, diagnosing the tool's read of a repository rather than the repository itself. The histograms are the fastest way to spot a wrong config: one layer means no rule matched, one service means detection found no manifest. */
export function diagnose(payload, diagnostics, out) {
  const { stats } = diagnostics;
  report(payload, diagnostics, out);

  if (stats.unresolvedSpecs.length) {
    // Grouped by specifier: one missing alias accounts for a hundred of these, and a flat list would hide that.
    out(`atlas: unresolved specifiers, most common first`);
    outRanked(rankedCounts(stats.unresolvedSpecs, (u) => u.spec), out);
  }

  // Registrations seen but not turnable into an endpoint without guessing, grouped by file because one helper accounts for most of them.
  const skips = payload.endpoints.skips ?? [];
  if (skips.length) {
    out(`atlas: endpoint registrations skipped (non-literal path or invisible method)=${skips.length}`);
    outRanked(rankedCounts(skips, (k) => k.file), out);
  }

  // "No endpoints here" and "no adapter for this language" look identical from outside, and only one is a fact about the repository; reported by language, since one missing adapter is otherwise a hundred lines.
  const unscanned = payload.endpoints.unscanned ?? [];
  if (unscanned.length) {
    const total = unscanned.reduce((a, [, n]) => a + n, 0);
    out(`atlas: files no endpoint rule could be run over (no adapter for the language)=${total}`);
    for (const [lang, n] of unscanned) out(`  ${String(n).padStart(4)} ${lang}`);
  }

  for (const [title, key, order] of [
    ["layers", "layer", payload.layers.map((l) => l.id)],
    ["services", "service", payload.services.map((s) => s.id)],
  ]) {
    const counts = new Map(order.map((id) => [id, 0]));
    for (const n of payload.nodes) counts.set(n[key], (counts.get(n[key]) ?? 0) + 1);
    const used = [...counts].filter(([, n]) => n > 0);
    out(`atlas: ${title} in use=${used.length}/${counts.size}`);
    for (const [id, n] of used) out(`  ${String(n).padStart(4)} ${id}`);
  }
}

/** `atlas findings` — the structural diagnosis of the repository itself. A muted finding still counts and still prints, grouped separately, so muting stays visible. */
export function findingsReport(payload, out) {
  const all = payload.findings ?? [];
  const active = all.filter((f) => !f.muted);
  const muted = all.length - active.length;
  out(`atlas: ${active.length} finding(s)${muted ? `, ${muted} muted` : ""}`);
  if (!active.length) return;

  const bySeverity = new Map();
  for (const f of active) bySeverity.set(f.severity, (bySeverity.get(f.severity) ?? 0) + 1);
  for (const sev of ["error", "warning", "info"]) {
    if (bySeverity.has(sev)) out(`  ${String(bySeverity.get(sev)).padStart(4)} ${sev}`);
  }

  const byType = new Map();
  for (const f of active) {
    if (!byType.has(f.type)) byType.set(f.type, []);
    byType.get(f.type).push(f);
  }
  for (const [type, findings] of byType) {
    out(`atlas: ${type} (${findings.length})`);
    for (const f of findings.slice(0, 10)) {
      out(`  [${f.severity}] ${f.message}`);
      out(`    -> ${f.why}`);
      out(`    id: ${f.id}`);
    }
    if (findings.length > 10) out(`  +${findings.length - 10} more`);
  }

  if (muted) {
    out(`atlas: muted (${muted})`);
    for (const f of all.filter((f) => f.muted).slice(0, 10)) out(`  [${f.type}] ${f.id} — ${f.muteReason}`);
    if (muted > 10) out(`  +${muted - 10} more`);
  }
}
