/**
 * Viewer assembly: one HTML file, no build step, no network.
 *
 * The viewer's numbered modules are CONCATENATED into a single <script>, never
 * emitted as separate <script src> tags. Top-level `const` is script-scoped, so
 * separate tags would work in `build` (one file, one scope) and break in
 * `serve` (many tags, many scopes) — a bug class that only appears in one mode.
 * Any new viewer file must therefore be safe to concatenate: no duplicate
 * top-level names.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VIEWER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "viewer");

const MARKERS = {
  style: "/*__ATLAS_STYLE__*/",
  script: "/*__ATLAS_SCRIPT__*/",
  data: "/*__ATLAS_DATA__*/",
};

/** The viewer modules in load order. Filename order IS load order. */
export function viewerFiles(dir = VIEWER_DIR) {
  return readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
}

export function bundleScript(dir = VIEWER_DIR) {
  return viewerFiles(dir).map((f) => readFileSync(path.join(dir, f), "utf8")).join("");
}

/**
 * `<` is escaped so a path or note containing `</script>` cannot close the tag;
 * U+2028/U+2029 are escaped because they are literal line terminators in JS
 * source but legal inside a JSON string.
 */
export function encodePayload(payload) {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function assemble(payload, dir = VIEWER_DIR) {
  let html = readFileSync(path.join(dir, "index.html"), "utf8");
  const parts = {
    style: readFileSync(path.join(dir, "style.css"), "utf8"),
    script: bundleScript(dir),
    data: encodePayload(payload),
  };
  for (const [name, marker] of Object.entries(MARKERS)) {
    // Exactly one, or the substitution is ambiguous and the failure would be a
    // silently half-built page.
    if (html.split(marker).length !== 2) {
      throw new Error(`viewer index.html must contain exactly one ${marker}`);
    }
    html = html.replace(marker, () => parts[name]);
  }
  return html;
}
