const express = require("express");
const router = express.Router();

const userRoutes = require("./user.routes");
const messageRoutes = require("./message.routes");
const sessionRoutes = require("./session.routes");

// Prefijos de rutas
router.use("/users", userRoutes);
router.use("/messages", messageRoutes);
router.use("/sessions", sessionRoutes);

module.exports = router;