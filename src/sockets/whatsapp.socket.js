const userService = require('../services/user.service');

// Almacenar sockets de usuarios (también lo puedes guardar en global si prefieres)
const userSockets = {};

const initializeSocketEvents = (io) => {
    io.on('connection', (socket) => {
        console.log('📡 Socket conectado:', socket.id);

        socket.on('joinSession', async (id_externo) => {
            try {
                console.log(`👤 Usuario ${id_externo} se unió con socket: ${socket.id}`);

                // Verificar si ya existe un socket para este usuario
                const oldSocketId = userSockets[id_externo];
                if (oldSocketId && oldSocketId !== socket.id) {
                    console.log(
                        `⚠️ Reemplazando socket anterior ${oldSocketId} con ${socket.id} para usuario ${id_externo}`
                    );

                    // Desconectar el socket antiguo de la sala
                    const oldSocket = io.sockets.sockets.get(oldSocketId);
                    if (oldSocket) {
                        oldSocket.leave(id_externo);
                    }
                }

                // Guardar el nuevo socket del usuario
                userSockets[id_externo] = socket.id;
                socket.data.id_externo = id_externo;

                // Unir a una sala específica
                socket.join(id_externo);

                // Verificar sesión en memoria
                const whatsappService = require('../services/whatsapp.service');
                
                const session = whatsappService.getSession(id_externo);

                if (session) {
                    await handleExistingSession(socket, id_externo, session);
                } else {
                    await handleNewSession(socket, id_externo, whatsappService);
                }

            } catch (error) {
                console.error(`❌ Error en joinSession para ${id_externo}:`, error);
                socket.emit('log', 'Error al unirse a la sesión');
            }
        });

        socket.on('disconnect', () => {
            console.log('🔌 Cliente desconectado:', socket.id);

            // Limpiar el socket del usuario
            const id_externo = socket.data.id_externo;
            if (id_externo && userSockets[id_externo] === socket.id) {
                delete userSockets[id_externo];
                console.log(`🧹 Socket eliminado para ${id_externo}`);
            }
        });
    });
};

// Función auxiliar: Manejar sesión existente
async function handleExistingSession(socket, id_externo, session) {
    if (session.qrCode) {
        // Tiene QR pendiente
        socket.emit('qr', session.qrCode);
        socket.emit('log', 'QR pendiente de escaneo');
        console.log(`📤 QR enviado a ${id_externo}`);
        return;
    }

    if (session.connectedAt) {
        // Ya está conectado
        socket.emit('qrstatus', './assets/check.svg');
        socket.emit('log', 'Usuario conectado');
        console.log(`✅ Usuario ${id_externo} ya conectado`);

        // Enviar información del usuario
        await sendUserInfo(socket, id_externo);
    }
}

// Función auxiliar: Manejar nueva sesión
async function handleNewSession(socket, id_externo, whatsappService) {
    try {
        const user = await userService.getUserByIdExterno(id_externo);

        if (!user) {
            socket.emit('log', 'Usuario no encontrado');
            console.log(`❌ Usuario ${id_externo} no existe en BD`);
            return;
        }

        // Verificar si debe restaurar sesión
        if (user.estado === 'conectado' || user.estado === 'desconectado') {
            socket.emit('qrstatus', './assets/loader.gif');
            socket.emit('log', 'Restaurando sesión...');

            console.log(`🔄 Restaurando sesión para: ${id_externo}`);

            whatsappService.connectToWhatsApp(id_externo, user.receive_messages)
                .catch((err) => {
                    console.error(`❌ Error restaurando sesión para ${id_externo}:`, err);
                    socket.emit('log', 'Error al restaurar sesión');
                    socket.emit('qrstatus', './assets/loader.gif');
                });
        } else {
            socket.emit('log', 'Sin sesión activa. Inicia sesión escaneando el QR.');
            console.log(`ℹ️ Sin sesión para ${id_externo}`);
        }

    } catch (error) {
        console.error('❌ Error verificando sesión en BD:', error);
        socket.emit('log', 'Error al verificar sesión');
    }
}

// Función auxiliar: Enviar información del usuario
async function sendUserInfo(socket, id_externo) {
    try {
        const user = await userService.getUserByIdExterno(id_externo);

        if (!user) {
            console.warn(`⚠️ Usuario ${id_externo} no encontrado en BD`);
            return;
        }

        const userData = {
            id: user._id || user.id || id_externo,
            nombre: user.nombre || 'Usuario sin nombre',
            id_externo: user.id_externo,
            fecha: user.fechaCreacion,
            receive_messages: user.receive_messages,
        };

        // Enviar por ambos eventos para compatibilidad
        socket.emit('connected', userData);
        socket.emit('user', userData);

        console.log(`📤 Info de usuario enviada para ${id_externo}`);

    } catch (error) {
        console.error('❌ Error obteniendo info de usuario:', error);
    }
}

module.exports = { initializeSocketEvents };