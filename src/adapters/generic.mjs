/**
 * Fallback adapter: no import edges, still a legible atlas.
 *
 * A repo whose language has no adapter (or whose idiom has no import
 * statements at all — Rails autoloading, same-package Go references) must still
 * render its structure, sizes and endpoints. Returning nothing here is a
 * supported outcome, not a failure.
 */
export default {
  id: "generic",
  extensions: [],
  extractImports() {
    return [];
  },
  resolve(from, spec) {
    return { kind: "external", ids: [spec] };
  },
};
