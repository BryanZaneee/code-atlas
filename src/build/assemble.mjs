/** Viewer assembly: one HTML file, no build step, no network. The numbered modules are concatenated into a single <script> because top-level `const` is script-scoped, so separate tags would work in `build` and break in `serve`; a new viewer file must carry no duplicate top-level names. */
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

/** `<` is escaped so a path containing `</script>` cannot close the tag; U+2028/U+2029 are line terminators in JS source but legal inside a JSON string. */
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
    // Exactly one, or the substitution is ambiguous and the failure is a silently half-built page.
    if (html.split(marker).length !== 2) {
      throw new Error(`viewer index.html must contain exactly one ${marker}`);
    }
    html = html.replace(marker, () => parts[name]);
  }
  return html;
}
