const express = require("express");
const router = express.Router();
const messageController = require("../controllers/message.controller");
const { validateSendMessage, validateIdExterno } = require("../middlewares/validation.middleware");

// Enviar mensaje
router.post(
    "/:id_externo",
    validateIdExterno,
    validateSendMessage,
    messageController.sendMessage
);

// Enviar mensaje multimedia
router.post(
    "/media/:id_externo",
    validateIdExterno,
    messageController.sendMediaMessage
);

// Enviar mensajes lid
router.post(
    "/lid-media/:id_externo",
    validateIdExterno,
    messageController.sendLidMessage
);

// Enviar mensajes lid
router.post(
    "/universal-media/:id_externo",
    validateIdExterno,
    messageController.sendMediaMessageUniversal
);

module.exports = router;