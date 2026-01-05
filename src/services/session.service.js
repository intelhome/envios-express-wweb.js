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
        console.log(`🗑️ Eliminando sesión completa: ${id_externo}`);

        // 1. Destruir cliente si existe (con espera)
        const session = whatsappService.getSession(id_externo);
        if (session?.client) {
            try {
                await session.client.logout().catch(() => { });
                await session.client.destroy();
                console.log(`✅ Cliente destruido: ${id_externo}`);

                // Esperar a que se liberen los archivos
                console.log(`⏳ Esperando liberación de archivos...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (error) {
                console.error(`⚠️ Error destruyendo cliente:`, error.message);
            }
        }

        // 2. Eliminar de memoria
        whatsappService.deleteSessionFromMemory(id_externo);

        // 3. Eliminar de base de datos
        await userService.deleteUser(id_externo);
        console.log(`✅ Usuario eliminado de DB: ${id_externo}`);

        // 4. Eliminar archivos físicos con reintentos
        const authPath = path.join(__dirname, '../../.wwebjs_auth/sessions', `session-${id_externo}`);

        if (await fs.pathExists(authPath)) {
            const maxIntentos = 5;
            let eliminado = false;

            for (let intento = 1; intento <= maxIntentos; intento++) {
                try {
                    await fs.remove(authPath);
                    console.log(`✅ Archivos eliminados: ${authPath}`);
                    eliminado = true;
                    break;
                } catch (error) {
                    if (error.code === 'EBUSY' || error.code === 'EPERM') {
                        if (intento < maxIntentos) {
                            console.log(`⏳ Intento ${intento}/${maxIntentos} - Esperando 2s...`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } else {
                            console.warn(`⚠️ No se pudieron eliminar archivos después de ${maxIntentos} intentos`);
                            // Renombrar para eliminar manualmente
                            try {
                                const deletePath = authPath.replace(/session-/, 'DELETE_session-');
                                await fs.rename(authPath, deletePath);
                                console.log(`📝 Carpeta renombrada para limpieza posterior: ${deletePath}`);
                            } catch (renameError) {
                                console.error(`❌ No se pudo renombrar:`, renameError.message);
                            }
                        }
                    } else {
                        throw error;
                    }
                }
            }
        } else {
            console.log(`ℹ️ No se encontraron archivos en: ${authPath}`);
        }

        console.log(`✅ Sesión completamente eliminada: ${id_externo}`);
        return true;

    } catch (error) {
        console.error(`❌ Error eliminando sesión ${id_externo}:`, error);
        return false;
    }
};