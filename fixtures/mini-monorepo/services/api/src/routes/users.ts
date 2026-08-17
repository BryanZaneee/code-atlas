import { Router } from "express";
import { getUser, listUsers } from "../services/user-service.js";

export function createUserRoutes() {
  const router = Router();
  router.get("/users", async (_req, res) => res.json(await listUsers()));
  router.get("/users/:id", async (req, res) => res.json(await getUser(req.params.id)));
  router.post("/users", async (req, res) => res.json(await getUser(req.body.id)));
  return router;
}
