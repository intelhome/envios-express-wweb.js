let io = null;
const sockets = {};

/**
 * Configurar instancia de Socket.IO
 */
exports.setIO = (ioInstance) => {
    io = ioInstance;
    console.log('✅ Socket.IO configurado en socket.service');
};

/**
 * Obtener instancia de Socket.IO
 */
exports.getIO = () => {
    if (!io) {
        console.warn('⚠️ Socket.IO no está configurado');
    }
    return io;
};

/**
 * Registrar socket de un cliente
 */
exports.registerSocket = (id_externo, socketId) => {
    sockets[id_externo] = socketId;
    console.log(`📝 Socket registrado: ${id_externo} → ${socketId}`);
};

/**
 * Obtener socket de un cliente
 */
exports.getSocket = (id_externo) => {
    return sockets[id_externo];
};

/**
 * Emitir QR code
 */
exports.emitQR = (id_externo, qrCodeData) => {
    if (!io) {
        console.warn('⚠️ Socket.IO no disponible para emitir QR');
        return;
    }

    console.log(`📤 Emitiendo QR a sala: ${id_externo}`);
    io.to(id_externo).emit('qr', qrCodeData);
};

/**
 * Emitir estado de autenticación
 */
exports.emitAuthStatus = (id_externo) => {
    if (!io) {
        console.warn('⚠️ Socket.IO no disponible para emitir auth status');
        return;
    }

    console.log(`📤 Emitiendo authenticated a sala: ${id_externo}`);
    io.to(id_externo).emit('authenticated');
};

/**
 * Emitir conexión exitosa
 */
exports.emitConnected = (id_externo, userData = null) => {
    if (!io) {
        console.warn('⚠️ Socket.IO no disponible para emitir connected');
        return;
    }

    console.log(`📤 Emitiendo ready a sala: ${id_externo}`);

    const payload = userData ? {
        id: userData.id || userData._id || id_externo,
        nombre: userData.nombre || userData.name || 'Usuario sin nombre',
        id_externo: userData.id_externo || id_externo,
        fecha: userData.fecha || userData.fechaCreacion,
        receive_messages: userData.receive_messages || false,
        timestamp: Date.now()
    } : {
        id_externo: id_externo,
        timestamp: Date.now()
    };

    io.to(id_externo).emit("qrstatus", "/assets/check.svg");
    io.to(id_externo).emit("log", `Conectado: ${payload.nombre}`);
    io.to(id_externo).emit("user", payload);

    io.to(id_externo).emit("connected", payload);
};

/**
 * Emitir desconexión
 */
exports.emitDisconnected = (id_externo) => {
    if (!io) {
        console.warn('⚠️ Socket.IO no disponible para emitir disconnected');
        return;
    }

    console.log(`📤 Emitiendo disconnected a sala: ${id_externo}`);
    io.to(id_externo).emit('disconnected');

    io.to(id_externo).emit('log', 'Sesión cerrada y eliminada');
    io.to(id_externo).emit('qrstatus', '/assets/disconnected.svg');
};