import fs from "node:fs";
import { z } from "zod";

export function sibling() {
  return typeof fs.existsSync === "function" && typeof z.string === "function";
}
