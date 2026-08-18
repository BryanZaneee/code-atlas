/**
 * Adapter registry. Adapters are the documented contribution surface, so this
 * list is the only thing a new language has to join.
 */
import ts from "./ts.mjs";
import py from "./py.mjs";

export const ADAPTERS = [ts, py];

/**
 * The adapter that owns a path, or null. Null means "no edges from this file" —
 * a .md, .sql or .json file has none, and that is a fact rather than a gap. It
 * is also what endpoint extraction asks before running a rule over a file, so
 * "no adapter" is a coverage answer as well as an edge one.
 */
export function adapterFor(p) {
  return ADAPTERS.find((a) => a.extensions.some((e) => p.endsWith(e))) ?? null;
}
