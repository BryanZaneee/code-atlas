/**
 * What the CLI prints.
 *
 * `report()` is the build's commentary and goes to stderr; `diagnose()` is
 * `atlas scan`'s whole output and goes to stdout. Both only ever read a
 * finished payload and format it, which is why they live beside the CLI rather
 * than in the pipeline that produced it.
 */
/** `a, b, c, +N more` — a sample long enough to recognise, short enough to read. */
function sample(items, n) {
  return items.slice(0, n).join(", ") + (items.length > n ? `, +${items.length - n} more` : "");
}

/** The stderr summary. Everything logs to stderr so --json stdout stays clean. */
export function report(payload, diagnostics, warn) {
  const { stats, unclassified, orphanTests } = diagnostics;
  const m = payload.meta;
  // Which rung ran decides whether this picture is reproducible from a commit,
  // so it leads the report rather than hiding in the payload.
  const a = m.acquisition;
  const at = a.commit ? `@ ${a.commit}` : "uncommitted";
  warn(`atlas: ${a.mode} ${a.ref ?? ""} ${at}${a.dirty ? " · DIRTY" : ""}`);
  warn(`atlas: ${m.fileCount} code files, ${m.lineCount} lines, ${m.edgeCount} edges, ${m.endpointCount} endpoints`);
  warn(`atlas: imports resolved=${stats.resolved} unresolved=${stats.unresolved} external=${stats.external}`);
  // The unsorted share is the honest read on classification quality: a repo
  // whose layout no rule recognises still renders, and this is how you find out
  // that is what happened rather than wondering why it is one column.
  const share = m.fileCount ? Math.round((unclassified.length / m.fileCount) * 100) : 0;
  warn(`atlas: unsorted files=${unclassified.length} (${share}% — placed by fallback)${unclassified.length ? " -> " + sample(unclassified, 6) : ""}`);
  warn(`atlas: tests without a subject=${orphanTests.length}${orphanTests.length ? " -> " + orphanTests.map((n) => n.name).join(", ") : ""}`);
}

/**
 * `atlas scan` — the long form of the same report.
 *
 * This diagnoses the *tool's read* of a repository, not the repository:
 * which specifiers it could not place, and how its files fell across the
 * columns and rows it drew. `atlas findings` (phase 5) is the one that
 * diagnoses the code.
 *
 * The histograms are the fastest way to see a config is wrong: every file in
 * one layer means no rule matched anything, and every file in one service means
 * detection found no manifest.
 */
export function diagnose(payload, diagnostics, out) {
  const { stats } = diagnostics;
  report(payload, diagnostics, out);

  if (stats.unresolvedSpecs.length) {
    // Grouped by specifier: one missing alias accounts for a hundred of these,
    // and a list of a hundred identical lines hides that fact rather than showing it.
    const by = new Map();
    for (const u of stats.unresolvedSpecs) by.set(u.spec, (by.get(u.spec) ?? 0) + 1);
    const ranked = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out(`atlas: unresolved specifiers, most common first`);
    for (const [spec, n] of ranked.slice(0, 20)) out(`  ${String(n).padStart(4)} × ${spec}`);
    if (ranked.length > 20) out(`  +${ranked.length - 20} more`);
  }

  // Endpoint registrations the extractor saw but could not turn into an
  // endpoint without guessing — a non-literal path, or a literal path handed
  // to a helper whose method this tool does not follow. Grouped by file the
  // same way unresolved specifiers are grouped by spec: one helper accounts
  // for most of these, and a flat list of a dozen identical lines hides that.
  const skips = payload.endpoints.skips ?? [];
  if (skips.length) {
    const by = new Map();
    for (const s of skips) by.set(s.file, (by.get(s.file) ?? 0) + 1);
    const ranked = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out(`atlas: endpoint registrations skipped (non-literal path or invisible method)=${skips.length}`);
    for (const [file, n] of ranked.slice(0, 20)) out(`  ${String(n).padStart(4)} × ${file}`);
    if (ranked.length > 20) out(`  +${ranked.length - 20} more`);
  }

  // "No endpoints here" and "this tool cannot read this language" are the same
  // empty result from the outside, and only one of them is a fact about the
  // repository. Reported by language rather than per file: one missing adapter
  // is otherwise a hundred identical lines that hide the cause.
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
