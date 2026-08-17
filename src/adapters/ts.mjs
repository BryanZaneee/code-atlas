/**
 * TypeScript adapter.
 *
 * `resolve` returns an ARRAY of ids: one specifier can name many files in other
 * languages (Go packages, Java wildcards), and a re-export barrel does the same
 * here, so the shape is an array everywhere rather than a special case.
 *
 * Phase 3 adds tsconfig paths/baseUrl, workspace names, extensionless imports,
 * and the require()/dynamic-import forms. This is the prototype's resolver,
 * unchanged.
 */
import path from "node:path";

const FROM = /\bfrom\s*["']([^"']+)["']/g;

export default {
  id: "ts",
  extensions: [".ts"],

  extractImports(text) {
    const out = [];
    for (const m of text.matchAll(FROM)) out.push({ spec: m[1], kind: "static" });
    return out;
  },

  resolve(from, spec, ctx) {
    if (!spec.startsWith(".")) {
      const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      return { kind: "external", ids: [pkg] };
    }
    // NodeNext forces an explicit extension on every relative import in the
    // reference repo, so the resolver is the .js -> .ts swap plus the literal
    // path. Phase 3 widens this; widening it early would change the payload.
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    for (const c of [base.replace(/\.js$/, ".ts"), base, `${base}.ts`, `${base}/index.ts`]) {
      if (ctx.fileSet.has(c)) return { kind: "internal", ids: [c] };
    }
    return { kind: "unresolved", ids: [base] };
  },
};
