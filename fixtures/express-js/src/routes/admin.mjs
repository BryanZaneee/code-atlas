import express from "express";
import { log } from "../../lib/log.js";

const router = express.Router();

// A literal path, in an .mjs file, mounted at /admin by the server.
router.get("/stats", (req, res) => { log("stats"); res.json({}); });

// Deliberately non-literal: this must be SKIPPED and counted, never guessed.
const pathFromConfig = process.env.ADMIN_PATH || "/danger";
router.post(pathFromConfig, (req, res) => res.status(202).end());

export default router;
