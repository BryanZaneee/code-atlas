import { router } from "./routes/items.js";
import { log } from "./utils/log.js";

log("boot");
export const app = router;
