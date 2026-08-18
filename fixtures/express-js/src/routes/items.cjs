const express = require("express");
const { log } = require("../../lib/log.js");

const router = express.Router();

router.get("/", (req, res) => { log("list"); res.json([]); });
router.get("/:id", (req, res) => res.json({ id: req.params.id }));
router.delete("/:id", (req, res) => res.status(204).end());

module.exports = router;
