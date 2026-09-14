// Bound by a destructured require: `const { adminRouter } = require(...)`.
const express = require("express");
const adminRouter = express.Router();

adminRouter.get("/stats", (req, res) => res.json({}));

module.exports = { adminRouter };
