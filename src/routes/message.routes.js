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
    "/:id_externo/media",
    validateIdExterno,
    messageController.sendMediaMessage
);

module.exports = router;