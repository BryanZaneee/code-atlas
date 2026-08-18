import { adminRouter } from "./admin/index.js";
import { log } from "../utils/log.js";

export const itemsRouter = {
  route: (prefix: string, r: unknown) => [prefix, r],
  get: (p: string) => p,
  post: (p: string) => p,
};

itemsRouter.route("/items", adminRouter);
itemsRouter.get("/items");
itemsRouter.post("/items");
log("items");
