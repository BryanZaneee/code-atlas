/**
 * Test suite classification and test -> subject mapping.
 *
 * Suite membership is read out of the project's own test-runner config rather
 * than guessed, so unit/integration/pact stays correct when the project changes
 * it. Config names the files to read; the glob translation is generic.
 */
import path from "node:path";

/** Pull a string array out of a config file by regex. No AST — see CLAUDE.md. */
function extractArray(text, key) {
  const m = text.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : [];
}

/**
 * A glob to a RegExp. The globstar form is split out first and each remaining
 * segment expanded on its own, so the single-star pass cannot eat it and no
 * sentinel character is needed to protect it.
 */
export const globToRe = (g) =>
  new RegExp(
    "^" +
      g
        .split("**/")
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
        .join("(?:.*/)?") +
      "$",
  );

export function readSuites(ctx) {
  const suites = [];
  for (const [file, kind] of ctx.config.suiteConfigs ?? []) {
    const t = ctx.src.get(file);
    if (!t) continue;
    suites.push({
      kind,
      include: extractArray(t, "include").map(globToRe),
      exclude: extractArray(t, "exclude").map(globToRe),
    });
  }
  return suites;
}

/** Shared helpers and conftest are not anybody's subject. */
export const FIXTURE = /(^|\/)conftest\.py$|(^|\/)(helpers|fixtures)\//;

const tokens = (f) =>
  (f.split("/").pop() ?? "").replace(/^test_|\.test\.ts$|\.(ts|py)$/g, "").split(/[.\-_]/).filter(Boolean);

/**
 * Cascade: path convention, then the best token overlap among the test's own
 * imports. Python tests import the app entrypoint rather than their nominal
 * subject, and the TS convention has holes (audit-entry.test.ts ->
 * audit-entry.repository.ts), so neither mechanism is sufficient alone.
 */
export function subjectOf(p, internal, ctx) {
  const { layerOf } = ctx.config;
  const conv = p.endsWith(".ts")
    ? p.replace("/test/", "/src/").replace(/\.test\.ts$/, ".ts")
    : p.replace("/test/", "/app/").replace(/(^|\/)test_([^/]+)\.py$/, "$1$2.py");
  if (ctx.fileSet.has(conv) && conv !== p) return conv;

  const want = tokens(p);
  const dir = path.posix.dirname(p).split("/").pop();
  let best = null;
  let bestScore = 0;
  for (const i of internal) {
    if (FIXTURE.test(i) || layerOf(i).layer === "tooling") continue;
    const have = tokens(i);
    let score = have.filter((t) => want.includes(t)).length;
    if (!score) continue;
    if (path.posix.dirname(i).split("/").pop() === dir) score += 0.5; // mirrored dir breaks ties
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  if (best) return best;

  const real = [...internal].filter((i) => !FIXTURE.test(i) && layerOf(i).layer !== "tooling");
  return real.length === 1 ? real[0] : null;
}
