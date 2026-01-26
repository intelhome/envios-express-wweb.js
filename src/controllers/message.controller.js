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

        if (result.success === false) {
            return res.status(400).json({
                status: false,
                response: result.message,
            });
        }

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

        // Validación mínima
        if (!number) {
            return res.status(400).json({
                status: false,
                response: "El número es requerido"
            });
        }

        // Delegar toda la lógica al service
        const result = await messageService.sendMediaMessage(
            id_externo,
            req.body  // Pasa todo el body
        );

        if (result.success === false) {
            return res.status(400).json({
                status: false,
                response: result.message,
            });
        }

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

async function sendLidMessage(req, res) {
    try {
        const { id_externo } = req.params;
        const messageData = req.body;

        // Validar datos requeridos
        if (!messageData.chatId) {
            return res.status(400).json({
                success: false,
                error: 'El campo chatId es requerido para contactos @lid'
            });
        }

        if (!messageData.message && !messageData.pdfBase64 && !messageData.imageBase64) {
            return res.status(400).json({
                success: false,
                error: 'Debes enviar un mensaje de texto o un archivo'
            });
        }

        const result = await messageService.sendLidMessage(id_externo, messageData);

        res.status(200).json({
            success: true,
            data: result,
            message: 'Mensaje enviado correctamente a contacto @lid'
        });

    } catch (error) {
        console.error('❌ Error en sendLidMessage controller:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

async function sendMediaMessageUniversal(req, res, next) {
    try {
        const { id_externo } = req.params;
        const { number, tempMessage, link, type, latitud, longitud, file } = req.body;

        // Validación: debe existir al menos uno
        if (!number) {
            return res.status(400).json({
                status: false,
                response: "Se requiere al menos uno: contact, number o lid"
            });
        }

        // Delegar toda la lógica al service
        const result = await messageService.sendMediaMessageUniversal(
            id_externo,
            req.body  // Pasa todo el body
        );

        if (result.success === false) {
            return res.status(400).json({
                status: false,
                response: result.message,
            });
        }

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

module.exports = {
    sendMessage,
    sendMediaMessage,
    sendLidMessage,
    sendMediaMessageUniversal
};