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

exports.getSessionStatus = (id_externo) => {
    const session = WhatsAppSessions[id_externo];
    if (!session) return null;

    return {
        status: session.status,
        qr: session.qr || null,
        ready: session.status === 'ready'
    };
};

// Funcion que valida que la sesion se  inicie al 100% 
async function waitForSessionReady(userId, timeout = 90000) {
    const startTime = Date.now();
    let authenticated = false;
    let authenticatedStartTime = null;

    while (Date.now() - startTime < timeout) {
        const session = WhatsAppSessions[userId];

        if (!session) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        // ✅ Llegó a ready
        if (session.status === 'ready') {
            return 'ready';
        }

        // 📱 Generó QR
        if (session.status === 'qr_code' || session.qr) {
            return 'qr';
        }

        // 🔄 Detectar authenticated pero no ready
        if (session.status === 'authenticated') {
            if (!authenticated) {
                authenticated = true;
                authenticatedStartTime = Date.now(); // Guardar el momento exacto
                console.log(`⏳ ${userId} autenticado, esperando ready (máximo 10s)...`);
            }

            // Si lleva más de 10s en authenticated, es timeout
            const timeInAuthenticated = Date.now() - authenticatedStartTime;
            if (timeInAuthenticated > 50000) { // 10 segundos
                console.warn(`⚠️ ${userId} quedó en authenticated por ${Math.round(timeInAuthenticated / 1000)}s, necesita reconexión`);
                return 'authenticated_stuck';
            }
        } else {
            // Reset si sale de authenticated
            if (authenticated) {
                authenticated = false;
                authenticatedStartTime = null;
            }
        }

        await new Promise(r => setTimeout(r, 2000));
    }

    // Timeout general
    console.error(`❌ ${userId} timeout después de ${timeout / 1000}s`);
    return 'timeout';
}

/**
 * Conectar a WhatsApp
 */
exports.connectToWhatsApp = async (id_externo, receiveMessages, retryCount = 0) => {
    const MAX_RETRIES = 2;
    let client = null;

    try {
        console.log(`🔄 Iniciando conexión para: ${id_externo}${retryCount > 0 ? ` (intento ${retryCount + 1})` : ''}`);

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
            retries: retryCount
        };
        console.log(`💾 Sesión guardada para ${id_externo}`);

        // Configurar eventos del cliente
        setupClientEvents(client, id_externo, receiveMessages);

        const timeout = process.env.DOCKER_ENV === 'true' ? 180000 : 180000;
        console.log(`🚀 Inicializando cliente (timeout: ${timeout / 1000}s)...`);

        await Promise.race([
            client.initialize(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout inicializando cliente (${timeout / 1000}s)`)), timeout)
            ),
        ]);

        // Cambiar manualmente estado a ready
        setTimeout(async () => {
            if (client.pupPage && WhatsAppSessions[id_externo]?.status !== 'ready') {
                const estaEnChats = await client.pupPage.evaluate(() => {
                    return !!document.querySelector('#side') || !!document.querySelector('.two');
                });

                if (estaEnChats) {
                    console.log("⚡Interfaz detectada manualmente. Disparando READY forzado.");
                    client.emit('ready');
                }
            }
        }, 10000);

        console.log(`✅ Cliente inicializado correctamente para ${id_externo}`);
        WhatsAppSessions[id_externo].status = 'initialized';

        // ⭐ ESPERAR A QUE LLEGUE A READY O GENERE QR
        // const finalStatus = await waitForSessionReady(id_externo, 90000);

        // if (finalStatus === 'ready') {
        //     console.log(`✅ ${id_externo} conectado exitosamente`);
        //     return client;
        // }

        // if (finalStatus === 'qr') {
        //     console.log(`📱 ${id_externo} esperando escaneo de QR`);
        //     return client;
        // }

        // // 🔄 Si quedó en authenticated_stuck, reintentar
        // if (finalStatus === 'authenticated_stuck' && retryCount < MAX_RETRIES) {
        //     console.log(`🔄 Reintentando conexión para ${id_externo}...`);

        //     // Limpiar cliente actual
        //     if (client) {
        //         try {
        //             client.removeAllListeners();
        //             await client.destroy();
        //         } catch (e) {
        //             console.warn(`⚠️ Error limpiando:`, e.message);
        //         }
        //     }

        //     // Esperar antes de reintentar
        //     await new Promise(r => setTimeout(r, 10000));

        //     // Reintentar recursivamente
        //     return await exports.connectToWhatsApp(id_externo, receiveMessages, retryCount + 1);
        // }

        // console.log(`⚠️ ${id_externo} timeout esperando conexión`);
        return client;

    } catch (error) {
        console.error(`❌ Error conectando WhatsApp para ${id_externo}:`, error.message);

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
    client.once('qr', async (qr) => {
        console.log(`📱 QR generado para: ${id_externo}`);

        const qrCodeData = await QRCode.toDataURL(qr);

        // Guardar en sesión
        WhatsAppSessions[id_externo] = {
            ...WhatsAppSessions[id_externo], // Mantener datos existentes
            client,
            status: 'qr_code', // ⭐ AÑADIR
            qr: qrCodeData, // ⭐ AÑADIR
            connectedAt: null,
            qrGeneratedAt: Date.now(),
            qrCode: qrCodeData,
        };

        socketService.emitQR(id_externo, qrCodeData);
    });

    client.once('authenticated', async () => {
        console.log(`✅ Autenticado: ${id_externo}`);

        // ⭐ AÑADIR
        if (WhatsAppSessions[id_externo]) {
            WhatsAppSessions[id_externo].status = 'authenticated';
            WhatsAppSessions[id_externo].qr = null;
        }

        await userService.updateUser(id_externo, { estado: 'autenticado' });
        socketService.emitAuthStatus(id_externo);
    });

    client.once('ready', async () => {
        console.log(`✔️ Cliente listo: ${id_externo}`);

        try {
            await client.pupPage.evaluate(() => {
                if (window.WWebJS?.sendSeen) {
                    window.WWebJS.sendSeen = () => { };
                }
            });

            const user = await userService.getUserByIdExterno(id_externo);

            if (!user) {
                console.error(`❌ Usuario no encontrado: ${id_externo}`);
                return;
            }

            WhatsAppSessions[id_externo] = {
                client,
                status: 'ready',
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

            if (global.gc) {
                global.gc();
                console.log(`🧹 GC ejecutado para ${id_externo}`);
            }
        } catch (error) {
            console.error(`❌ Error en ready ${id_externo}:`, error);
        }
    });

    if (client.pupPage) {
        client.pupPage.on('console', msg => {
            if (msg.text().includes('WWebJS')) {
                console.log('🖥️ Consola Navegador:', msg.text());
            }
        });
    }

    // Evento: Desconectado
    client.once('disconnected', async (reason) => {
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
    client.once('auth_failure', async (msg) => {
        console.error(`❌ Error de autenticación ${id_externo}:`, msg);
        await userService.updateUser(id_externo, {
            estado: 'error_autenticacion',
            error_msg: msg,
        });
        await sessionService.removeSession(id_externo);
    });

    // Recepción de mensajes
    if (receiveMessages) {
        client.once('message', async (message) => {
            await messageService.handleIncomingMessage(message, id_externo, client);
        });

        client.once('message_revoke_everyone', async (revokedMsg) => {
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