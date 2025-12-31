const whatsappService = require("../services/whatsapp.service");
const sessionService = require("../services/session.service");

/**
 * Cierra sesión de WhatsApp
 */
async function logout(req, res, next) {
    try {
        const { id_externo } = req.params;

        const result = await whatsappService.logoutWhatsApp(id_externo);

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
}

/**
 * Obtiene el estado de una sesión
 */
async function getSessionStatus(req, res, next) {
    try {
        const { id_externo } = req.params;

        const session = sessionService.getSession(id_externo);

        if (!session) {
            return res.json({
                connected: false,
                message: "No hay sesión activa",
            });
        }

        const client = session.client;
        const state = await client.getState().catch(() => null);

        res.json({
            connected: state === "CONNECTED",
            state: state,
            connectedAt: session.connectedAt,
            qrPending: !!session.qrCode,
        });
    } catch (error) {
        res.status(500).json({
            connected: false,
            error: error.message,
        });
    }
}

module.exports = {
    logout,
    getSessionStatus,
};