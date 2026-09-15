import express from "express";
import itemsRouter from "./routes/items.cjs";
import adminRouter from "./routes/admin.mjs";
import { orders } from "./routes/orders.mjs";
import { log } from "../lib/log.js";

const app = express();

app.get("/health", (req, res) => res.json({ ok: true }));
app.post("/login", (req, res) => {
  log("login");
  res.status(204).end();
});

app.use("/items", itemsRouter);
app.use("/admin", adminRouter);
app.use("/shop", orders);

export default app;
