const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const whatsAppConfig = require('../config/whatsapp');
const userService = require('./user.service');
const sessionService = require('./session.service');
const messageService = require('./message.service');
const socketService = require('./socket.service');
const { NO_RECONNECT_REASONS } = require('../config/whatsapp');

// Almacén de sesiones en memoria
const WhatsAppSessions = {};

/**
 * Conectar a WhatsApp
 */
exports.connectToWhatsApp = async (id_externo, receiveMessages) => {
    try {
        console.log(`🔄 Iniciando conexión para: ${id_externo}`);

        // ✅ LIMPIAR SESIÓN ANTERIOR SI EXISTE
        if (WhatsAppSessions[id_externo]?.client) {
            const existingClient = WhatsAppSessions[id_externo].client;

            console.log(`🧹 Detectada sesión anterior para ${id_externo}, limpiando...`);

            try {
                // Intentar destruir el cliente anterior
                if (typeof existingClient.destroy === 'function') {
                    await existingClient.destroy();
                    console.log(`✅ Cliente anterior destruido para ${id_externo}`);
                }
            } catch (destroyError) {
                console.warn(`⚠️ Error destruyendo cliente anterior:`, destroyError.message);
            }

            // Limpiar de memoria
            delete WhatsAppSessions[id_externo];

            // ✅ CRÍTICO: Esperar antes de crear nueva sesión
            console.log(`⏳ Esperando 3s antes de crear nueva sesión para ${id_externo}...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Crear nueva sesión
        const config = whatsAppConfig.getWhatsAppConfig(id_externo);
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: id_externo }),
            ...config
        });

        WhatsAppSessions[id_externo] = {
            client,
            status: 'connecting'
        };

        // Configurar eventos del cliente
        setupClientEvents(client, id_externo, receiveMessages);

        // Inicializar cliente con timeout
        await Promise.race([
            client.initialize(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout inicializando cliente')), 90000)
            ),
        ]);

        console.log(`✅ Cliente inicializado correctamente para ${id_externo}`);

        WhatsAppSessions[id_externo].status = 'initialized';

        return client;

    } catch (error) {
        console.error(`❌ Error conectando WhatsApp para ${id_externo}:`, error.message);

        // ✅ LIMPIAR EN CASO DE ERROR
        if (WhatsAppSessions[id_externo]) {
            try {
                if (WhatsAppSessions[id_externo].client) {
                    await WhatsAppSessions[id_externo].client.destroy();
                }
            } catch (cleanupError) {
                console.warn(`⚠️ Error limpiando después de fallo:`, cleanupError.message);
            }
            delete WhatsAppSessions[id_externo];
        }

        throw error;
    }
};

/**
 * Configurar eventos del cliente WhatsApp
 */
function setupClientEvents(client, id_externo, receiveMessages) {
    client.removeAllListeners();
    const user = userService.getUserByIdExterno(id_externo);

    // Evento: QR generado
    client.on('qr', async (qr) => {
        console.log(`📱 QR generado para: ${id_externo}`);

        const qrCodeData = await QRCode.toDataURL(qr);

        // Guardar en sesión
        WhatsAppSessions[id_externo] = {
            client,
            connectedAt: null,
            qrGeneratedAt: Date.now(),
            qrCode: qrCodeData,
        };

        socketService.emitQR(id_externo, qrCodeData);
    });

    // Evento: Autenticado
    client.on('authenticated', async () => {
        console.log(`✅ Autenticado: ${id_externo}`);
        await userService.updateUser(id_externo, { estado: 'autenticado' });
        socketService.emitAuthStatus(id_externo);
    });

    // Evento: Cliente listo
    client.on('ready', async () => {
        console.log(`✔️ Cliente listo: ${id_externo}`);

        WhatsAppSessions[id_externo] = {
            client,
            connectedAt: Date.now(),
            qrGeneratedAt: null,
            qrCode: null,
        };

        await userService.updateUser(id_externo, { estado: 'conectado' });
        socketService.emitConnected(id_externo, {
            id: user.id || id_externo,
            nombre: user.nombre || user.name || 'Usuario'
        });

        // Ejecutar garbage collection si está disponible
        if (global.gc) {
            global.gc();
            console.log(`🧹 GC ejecutado para ${id_externo}`);
        }
    });

    // Evento: Desconectado
    client.on('disconnected', async (reason) => {
        console.log(`❌ Desconectado ${id_externo}:`, reason);

        // 1. PRIMERO: Limpiar sesión de memoria INMEDIATAMENTE
        if (WhatsAppSessions[id_externo]) {
            delete WhatsAppSessions[id_externo];
            console.log(`✅ Sesión eliminada de memoria: ${id_externo}`);
        }

        // 2. SEGUNDO: Actualizar estado en BD (sin interactuar con el cliente)
        try {
            await userService.updateUser(id_externo, {
                estado: 'desconectado',
            });
            console.log(`✅ Estado actualizado en BD: ${id_externo}`);
        } catch (error) {
            console.error(`Error actualizando estado:`, error.message);
        }

        // 3. TERCERO: Emitir evento de socket
        try {
            socketService.emitDisconnected(id_externo);
            console.log(`✅ Socket notificado: ${id_externo}`);
        } catch (error) {
            console.error(`Error emitiendo socket:`, error.message);
        }

        // 4. CUARTO: Decidir si reconectar o no
        const shouldReconnect = !NO_RECONNECT_REASONS.includes(reason);

        if (shouldReconnect) {
            // Reconexión automática en 5 segundos
            console.log(`🔄 Reconectando en 5s: ${id_externo}`);
            setTimeout(async () => {
                try {
                    await exports.connectToWhatsApp(id_externo, receiveMessages);
                } catch (reconnectError) {
                    console.error(`❌ Error reconectando ${id_externo}:`, reconnectError.message);
                }
            }, 5000);
        } else {
            // Logout permanente - limpiar TODO después de un delay
            console.log(`🗑️ Logout permanente: ${id_externo}`);

            setTimeout(async () => {
                try {
                    if (client && typeof client.destroy === 'function') {
                        // ⭐ CLAVE: Remover TODOS los listeners antes de destruir
                        client.removeAllListeners();
                        console.log(`🧹 Listeners removidos: ${id_externo}`);

                        await client.destroy();
                        console.log(`🧹 Cliente destruido: ${id_externo}`);
                    }
                } catch (e) {
                    console.log(`⚠️ Error destruyendo cliente (ignorado): ${e.message}`);
                }
            }, 3000);
        }
    });
    // Evento: Error de autenticación
    client.on('auth_failure', async (msg) => {
        console.error(`❌ Error de autenticación ${id_externo}:`, msg);
        await userService.updateUser(id_externo, {
            estado: 'error_autenticacion',
            error_msg: msg,
        });
        await sessionService.removeSession(id_externo);
    });

    // Recepción de mensajes
    if (receiveMessages) {
        client.on('message', async (message) => {
            await messageService.handleIncomingMessage(message, id_externo, client);
        });

        client.on('message_revoke_everyone', async (revokedMsg) => {
            console.log(`🗑️ Mensaje eliminado: ${revokedMsg.id._serialized}`);
        });

        console.log(`📩 Recepción activada para: ${id_externo}`);
    }
}

/**
 * Obtener información del usuario conectado
 */
exports.getUserInfo = async (id_externo) => {
    const session = WhatsAppSessions[id_externo];

    if (!session) {
        throw new Error('No existe una sesión para este usuario');
    }

    const client = session.client;
    const state = await client.getState().catch(() => null);

    if (state !== 'CONNECTED') {
        throw new Error(`Cliente no conectado. Estado: ${state}`);
    }

    const info = await client.info;

    return {
        userId: info.wid._serialized,
        userName: info.pushname || info.wid.user,
        phoneNumber: info.wid.user,
        connectedAt: session.connectedAt,
        state,
    };
};

/**
 * Cerrar sesión de WhatsApp
 */
exports.logoutWhatsApp = async (id_externo) => {
    try {
        console.log(`🚪 Cerrando sesión: ${id_externo}`);

        const session = WhatsAppSessions[id_externo];

        if (!session?.client) {
            console.log(`⚠️ No hay sesión activa: ${id_externo}`);
            return { success: true, message: 'No había sesión activa' };
        }

        const client = session.client;
        const state = await client.getState().catch(() => null);

        if (state === 'CONNECTED') {
            await client.destroy();
            console.log(`✅ Cliente destruido: ${id_externo}`);
        }

        return { success: true, message: 'Sesión cerrada correctamente' };

    } catch (error) {
        console.error(`❌ Error en logout ${id_externo}:`, error);
        return { success: false, message: error.message };
    }
};

/**
 * Obtener cliente de WhatsApp por ID
 */
exports.getClient = (id_externo) => {
    return WhatsAppSessions[id_externo]?.client;
};

/**
 * Obtener sesión completa por ID
 */
exports.getSession = (id_externo) => {
    return WhatsAppSessions[id_externo];
};

/**
 * Exportar almacén de sesiones (para usar en otros servicios)
 */
exports.WhatsAppSessions = WhatsAppSessions;