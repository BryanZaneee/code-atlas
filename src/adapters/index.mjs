/** Adapter registry: the one list a new language has to join. */
import ts from "./ts.mjs";
import py from "./py.mjs";
import go from "./go.mjs";
import rb from "./rb.mjs";
import jvm from "./jvm.mjs";
import rs from "./rs.mjs";

export const ADAPTERS = [ts, py, go, rb, jvm, rs];

/** The adapter that owns a path, or null. Null means "no edges from this file", a fact rather than a gap, and is also endpoint extraction's coverage answer. */
export function adapterFor(p) {
  return ADAPTERS.find((a) => a.extensions.some((e) => p.endsWith(e))) ?? null;
}
