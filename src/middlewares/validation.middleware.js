/**
 * Validar creación de usuario
 */
exports.validateCreateUser = (req, res, next) => {
    const { nombre, id_externo, receive_messages } = req.body;

    if (!nombre || !id_externo || typeof receive_messages !== 'boolean') {
        return res.status(400).json({
            result: false,
            error: 'Faltan campos requeridos: nombre, id_externo, receive_messages'
        });
    }

    // Validar formato de id_externo
    if (!/^[a-zA-Z0-9_-]+$/.test(id_externo)) {
        return res.status(400).json({
            result: false,
            error: 'El id_externo solo puede contener letras, números, guiones y guiones bajos'
        });
    }

    next();
};

/**
 * Validar envío de mensaje
 */
exports.validateSendMessage = (req, res, next) => {
    const { number, message, tempMessage, pdfBase64, imageBase64 } = req.body;

    if (!number) {
        return res.status(400).json({
            status: false,
            response: 'El número es requerido'
        });
    }

    const messageText = message || tempMessage;

    if (!messageText && !pdfBase64 && !imageBase64) {
        return res.status(400).json({
            status: false,
            response: 'Debes proporcionar un mensaje o archivo'
        });
    }

    next();
};

exports.validateIdExterno = (req, res, next) => {
    const { id_externo } = req.params;

    if (!id_externo || id_externo.trim() === '') {
        return res.status(400).json({
            result: false,
            message: 'id_externo es requerido'
        });
    }

    next();
};