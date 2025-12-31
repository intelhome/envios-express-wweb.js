const express = require("express");
const router = express.Router();
const sessionController = require("../controllers/session.controller");
const { validateIdExterno } = require("../middlewares/validation.middleware");

// Cerrar sesión
router.post("/:id_externo/logout", validateIdExterno, sessionController.logout);

// Obtener estado de sesión
router.get("/:id_externo/status", validateIdExterno, sessionController.getSessionStatus);

module.exports = router;