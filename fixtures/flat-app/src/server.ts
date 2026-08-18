import { itemsRouter } from "./routes/items.js";
import { log } from "./utils/log.js";

const app = {
  route: (prefix: string, r: unknown) => [prefix, r],
  get: (p: string) => p,
};

log("boot");

// Two levels: this prefix and the one items.ts applies to its own sub-router
// have to compose, and neither file contains the resulting path.
app.route("/api", itemsRouter);
app.get("/health");

export { app };
