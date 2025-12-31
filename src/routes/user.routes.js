const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const { validateCreateUser, validateIdExterno } = require("../middlewares/validation.middleware");

// Crear usuario
router.post("/", validateCreateUser, userController.createUser);

// Obtener todos los usuarios
router.get("/", userController.getUsers);

// Obtener información de usuario específico
router.get("/:id_externo", validateIdExterno, userController.getUserInfo);

// Eliminar usuario
router.delete("/:id_externo", validateIdExterno, userController.deleteUser);

module.exports = router;