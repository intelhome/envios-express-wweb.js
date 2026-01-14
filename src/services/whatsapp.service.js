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
    let client = null;

    try {
        console.log(`🔄 Iniciando conexión para: ${id_externo}`);

        // ✅ LIMPIAR SESIÓN ANTERIOR SI EXISTE
        if (WhatsAppSessions[id_externo]?.client) {
            const existingClient = WhatsAppSessions[id_externo].client;
            console.log(`🧹 Detectada sesión anterior para ${id_externo}, limpiando...`);

            try {
                if (existingClient && typeof existingClient.removeAllListeners === 'function') {
                    existingClient.removeAllListeners();
                }
                if (existingClient && typeof existingClient.destroy === 'function') {
                    await existingClient.destroy();
                }
            } catch (destroyError) {
                console.warn(`⚠️ Error destruyendo cliente anterior:`, destroyError.message);
            }

            delete WhatsAppSessions[id_externo];

            // ⭐ Esperar más tiempo en Docker
            const waitTime = process.env.DOCKER_ENV === 'true' ? 8000 : 3000;
            console.log(`⏳ Esperando ${waitTime / 1000}s antes de crear nueva sesión...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // Crear nueva sesión
        const config = whatsAppConfig.getWhatsAppConfig(id_externo);
        client = new Client({
            authStrategy: new LocalAuth({ clientId: id_externo }),
            ...config
        });

        // ⭐ Guardar ANTES de inicializar
        WhatsAppSessions[id_externo] = {
            client,
            status: 'connecting',
            retries: 0
        };
        console.log(`💾 Sesión guardada para ${id_externo}`);

        // Configurar eventos del cliente
        setupClientEvents(client, id_externo, receiveMessages);

        // ⭐ Timeout más largo en Docker
        const timeout = process.env.DOCKER_ENV === 'true' ? 180000 : 90000;
        console.log(`🚀 Inicializando cliente (timeout: ${timeout / 1000}s)...`);

        await Promise.race([
            client.initialize(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout inicializando cliente (${timeout / 1000}s)`)), timeout)
            ),
        ]);

        console.log(`✅ Cliente inicializado correctamente para ${id_externo}`);
        WhatsAppSessions[id_externo].status = 'initialized';

        return client;

    } catch (error) {
        console.error(`❌ Error conectando WhatsApp para ${id_externo}:`, error.message);

        // ⭐ Si es error de protocolo, eliminar sesión corrupta
        if (error.message.includes('Protocol error') ||
            error.message.includes('Session closed')) {

            console.log(`🗑️ Eliminando sesión corrupta para ${id_externo}`);

            try {
                const fs = require('fs');
                const path = require('path');
                const sessionPath = path.join('.wwebjs_auth', `session-${id_externo}`);

                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(`✅ Sesión corrupta eliminada: ${sessionPath}`);
                }
            } catch (fsError) {
                console.warn(`⚠️ Error eliminando sesión:`, fsError.message);
            }
        }

        // ✅ Limpiar cliente
        if (client) {
            try {
                if (typeof client.removeAllListeners === 'function') {
                    client.removeAllListeners();
                }
                if (typeof client.destroy === 'function') {
                    await client.destroy();
                }
            } catch (cleanupError) {
                console.warn(`⚠️ Error limpiando cliente:`, cleanupError.message);
            }
        }

        // ✅ Limpiar de memoria
        if (WhatsAppSessions[id_externo]) {
            delete WhatsAppSessions[id_externo];
        }

        throw error;
    }
};

/**
 * Configurar eventos del cliente WhatsApp
 */
async function setupClientEvents(client, id_externo, receiveMessages) {
    client.removeAllListeners();

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

        try {
            await client.pupPage.evaluate(() => {
                if (window.WWebJS?.sendSeen) {
                    window.WWebJS.sendSeen = () => { };
                }
            });

            // ✅ OBTENER USUARIO FRESCO AQUÍ
            const user = await userService.getUserByIdExterno(id_externo);

            if (!user) {
                console.error(`❌ Usuario no encontrado: ${id_externo}`);
                return;
            }

            WhatsAppSessions[id_externo] = {
                client,
                connectedAt: Date.now(),
                qrGeneratedAt: null,
                qrCode: null,
            };

            await userService.updateUser(id_externo, { estado: 'conectado' });

            socketService.emitConnected(id_externo, {
                id: user._id || user.id || id_externo,
                nombre: user.nombre || user.name || 'Usuario',
                id_externo: user.id_externo,
                fecha: user.fechaCreacion || user.fecha,
                receive_messages: user.receive_messages,
            });

            // Ejecutar garbage collection si está disponible
            if (global.gc) {
                global.gc();
                console.log(`🧹 GC ejecutado para ${id_externo}`);
            }
        } catch (error) {
            console.error(`❌ Error en ready ${id_externo}:`, error);
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
 * Limpiar todos los procesos de Chrome/Chromium zombies
 */
exports.killZombieProcesses = async () => {
    try {
        console.log('🧹 Limpiando procesos zombies de Chrome...');

        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);

        const commands = [
            'pkill -f "chrome.*wwebjs_auth"',
            'pkill -f "chromium.*wwebjs_auth"'
        ];

        for (const cmd of commands) {
            try {
                await execPromise(cmd);
            } catch (error) {
                // Es normal que falle si no hay procesos
            }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('✅ Procesos zombies limpiados');

    } catch (error) {
        console.log('⚠️ Error limpiando procesos:', error.message);
    }
};


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
            delete WhatsAppSessions[id_externo];
            return { success: true, message: 'No había sesión activa' };
        }

        const client = session.client;

        try {
            const state = await client.getState().catch(() => null);

            if (state === 'CONNECTED') {
                // Hacer logout primero
                await client.logout().catch(() => { });
                console.log(`📤 Logout realizado: ${id_externo}`);
            }

            // Destruir el cliente
            await client.destroy();
            console.log(`✅ Cliente destruido: ${id_externo}`);

            // ⏱️ ESPERAR a que Chrome libere los archivos
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            console.error(`⚠️ Error al cerrar cliente: ${error.message}`);
        }

        // Eliminar de memoria
        delete WhatsAppSessions[id_externo];
        console.log(`🗑️ Sesión eliminada de memoria: ${id_externo}`);

        return { success: true, message: 'Sesión cerrada correctamente' };

    } catch (error) {
        console.error(`❌ Error en logout ${id_externo}:`, error);
        delete WhatsAppSessions[id_externo];
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

exports.deleteSessionFromMemory = (id_externo) => {
    if (WhatsAppSessions[id_externo]) {
        delete WhatsAppSessions[id_externo];
        console.log(`🗑️ Sesión eliminada de memoria: ${id_externo}`);
        return true;
    }
    return false;
};

/**
 * Exportar almacén de sesiones (para usar en otros servicios)
 */
exports.WhatsAppSessions = WhatsAppSessions;