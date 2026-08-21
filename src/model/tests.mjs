/** Test suite classification and test -> subject mapping, read from the project's own runner config. */
import path from "node:path";
import { adapterFor } from "../adapters/index.mjs";

/** Pull a string array out of a config file by regex. No AST — see CLAUDE.md. */
function extractArray(text, key) {
  const m = text.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : [];
}

/** Glob to RegExp; globstar is split out first so the single-star pass cannot eat it. */
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

/** Subject of a test: path convention first, then best token overlap among its imports; neither alone suffices. */
export function subjectOf(p, internal, ctx) {
  const { layerOf } = ctx.config;
  const conv = adapterFor(p)?.testSubject(p);
  if (conv && ctx.fileSet.has(conv) && conv !== p) return conv;

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
