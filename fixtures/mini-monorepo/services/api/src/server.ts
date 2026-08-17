import { createUserRoutes } from "./routes/users.js";
import express from "express";

export function createApp() {
  const app = express();
  app.use("/api", createUserRoutes());
  return app;
}
