const express = require("express");
const itemsRouter = require("./routes/items.js");
const { adminRouter } = require("./routes/admin.js");

const app = express();

// A mount that is not a mount. If this were read, every items route would move.
// app.use("/v2", itemsRouter);

app.use("/items", itemsRouter);
app.use("/admin", adminRouter);

module.exports = app;
