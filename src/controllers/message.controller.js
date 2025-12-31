const messageService = require("../services/message.service");

/**
 * Envía un mensaje de texto o multimedia
 */
async function sendMessage(req, res, next) {
    try {
        const { id_externo } = req.params;

        // Validación mínima
        const { number, message, tempMessage, pdfBase64, imageBase64 } = req.body;

        if (!number) {
            return res.status(400).json({
                status: false,
                response: "El número es obligatorio"
            });
        }

        if (!message && !tempMessage && !pdfBase64 && !imageBase64) {
            return res.status(400).json({
                status: false,
                response: "Debes proporcionar un mensaje o archivo"
            });
        }

        // Delegar toda la lógica al service
        const result = await messageService.sendMessage(
            id_externo,
            req.body  // Pasa todo el body
        );

        return res.status(200).json({
            status: true,
            response: result,
        });

    } catch (error) {
        res.status(500).json({
            status: false,
            response: error.message,
        });
    }
}

/**
 * Envía mensajes multimedia (imagen, video, audio, documento, ubicación)
 */
async function sendMediaMessage(req, res, next) {
    try {
        const { id_externo } = req.params;
        const { number, tempMessage, link, type, latitud, longitud, file } = req.body;

        // TODO: Implementar según tipo (image, video, audio, document, location)
        // Por ahora, respuesta básica

        res.status(200).json({
            status: true,
            response: "Funcionalidad en desarrollo",
        });
    } catch (error) {
        res.status(500).json({
            status: false,
            response: error.message,
        });
    }
}

module.exports = {
    sendMessage,
    sendMediaMessage,
};