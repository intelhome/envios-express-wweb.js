const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const whatsappService = require('./whatsapp.service');
const userService = require('./user.service');

/**
 * Inicializar sesiones existentes
 */
exports.initializeWhatsAppSessions = async (db) => {
    const collection = db.collection('registros_whatsapp');
    const users = await collection.find().toArray();

    if (users.length === 0) {
        console.log('ℹ️ No hay usuarios registrados');
        return;
    }

    console.log(`🔄 Inicializando ${users.length} sesiones...`);

    for (const user of users) {
        try {
            await whatsappService.connectToWhatsApp(
                user.id_externo,
                user.receive_messages
            );
        } catch (error) {
            console.error(`Error inicializando ${user.id_externo}:`, error.message);
        }
    }
};

/**
 * Cerrar sesión
 */
exports.logout = async (id_externo) => {
    return await whatsappService.logoutWhatsApp(id_externo);
};

/**
 * Obtener estado de la sesión
 */
exports.getSessionStatus = (id_externo) => {
    const session = whatsappService.getSession(id_externo);

    if (!session) {
        return {
            connected: false,
            message: 'Sin sesión activa'
        };
    }

    return {
        connected: !!session.connectedAt,
        connectedAt: session.connectedAt,
        qrAvailable: !!session.qrCode,
        state: session.client ? 'active' : 'inactive'
    };
};

/**
 * Eliminar sesión completamente
 */
exports.removeSession = async (id_externo) => {
    try {
        console.log(`🗑️ Eliminando sesión: ${id_externo}`);

        // 1. Eliminar de base de datos
        await userService.deleteUser(id_externo);

        // 3. Eliminar archivos físicos
        const authPath = path.join(__dirname, '../../.wwebjs_auth', `session-${id_externo}`);
        if (await fs.pathExists(authPath)) {
            await fs.remove(authPath);
            console.log(`✅ Archivos eliminados: ${authPath}`);
        }

        // 4. Destruir cliente si existe
        const session = whatsappService.getSession(id_externo);
        if (session?.client) {
            await session.client.destroy().catch(console.error);
        }

        console.log(`✅ Sesión eliminada: ${id_externo}`);
        return true;

    } catch (error) {
        console.error(`Error eliminando sesión ${id_externo}:`, error);
        return false;
    }
};