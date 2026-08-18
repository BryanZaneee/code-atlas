import { helper } from "./util/helper";
// Same alias syntax as app/, but this subtree's tsconfig declares no "paths"
// at all — it must not inherit app's table.
import "@/utils/shared";
// This directory has a file named lodash.ts, and no declared "baseUrl" — the
// bare specifier below must resolve to the real npm package, never to it.
import { x } from "lodash";

export function run() {
  return helper() && x;
}
