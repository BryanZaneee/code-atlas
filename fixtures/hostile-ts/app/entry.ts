import "./polyfill";
import "./shim.js";
// a fake import, never real: import "not-real" from "nowhere"
const note = `template referencing from "still-not-real" should stay inert`;

const legacy = require("./legacy");
import("./lazy").then((mod) => mod.run());

export { note, legacy };
