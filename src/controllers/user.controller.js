const userService = require("../services/user.service");
const whatsappService = require("../services/whatsapp.service");
const sessionService = require("../services/session.service");
const path = require("path");

/**
 * Crea un nuevo usuario
 */
const createUser = async (req, res, next) => {
    try {
        const { nombre, id_externo, descripcion, receive_messages } = req.body;

        // Verificar si ya existe
        const existingUser = await userService.getUserByIdExterno(id_externo);
        if (existingUser) {
            return res.status(400).json({
                result: false,
                error: "Ya existe un registro con el mismo identificador",
            });
        }

        // Crear usuario en DB
        const newUser = await userService.createUser({
            nombre,
            id_externo,
            descripcion,
            receive_messages,
        });

        // Conectar a WhatsApp
        await whatsappService.connectToWhatsApp(id_externo, receive_messages);

        res.json({
            result: true,
            success: "Usuario creado correctamente",
            registro: newUser,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Obtiene todos los usuarios registrados
 */
const getUsers = async (req, res, next) => {
    try {
        const users = await userService.getAllUsers();

        // Filtrar campos sensibles
        const filteredUsers = users.map((user) => {
            const { _id, qr, ...userWithoutSensitive } = user;
            return userWithoutSensitive;
        });

        res.json({
            result: true,
            success: "Datos obtenidos",
            data: filteredUsers,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Obtiene información de un usuario de WhatsApp
 */
const getUserInfo = async (req, res, next) => {
    try {
        const { id_externo } = req.params;

        const info = await whatsappService.getUserInfo(id_externo);

        res.json({
            result: true,
            status: true,
            ...info,
        });
    } catch (error) {
        res.status(404).json({
            result: false,
            status: false,
            response: error.message,
        });
    }
};

/**
 * Elimina un usuario
 */
const deleteUser = async (req, res, next) => {
    try {
        const { id_externo } = req.params;

        // Cerrar sesión primero
        await whatsappService.logoutWhatsApp(id_externo);

        // Limpiar sesión completa
        await sessionService.removeSession(id_externo);

        res.json({
            result: true,
            success: "Usuario eliminado correctamente",
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Página para escanear QR
 */
const scanQR = async (req, res, next) => {
    try {
        const { id_externo } = req.query;

        if (!id_externo) {
            return res.status(400).send("ID externo es necesario");
        }

        const user = await userService.getUserByIdExterno(id_externo);

        if (!user) {
            return res.status(404).send("Registro no encontrado");
        }

        res.sendFile(path.join(__dirname, "..", "client", "index.html"));
    } catch (error) {
        next(error);
    }
}

module.exports = {
    createUser,
    getUsers,
    getUserInfo,
    deleteUser,
    scanQR,
};