import { itemsRouter } from "./routes/items.js";

const app = {
  route: (prefix: string, r: unknown) => [prefix, r],
};

app.route("/api", itemsRouter);
