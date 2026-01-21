require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");

// Configuración y base de datos
const { connectToMongoDB, connectMongoose, closeConnections } = require("./config/database");
const { setupExpressApp } = require("./config/server");
const socketService = require('./services/socket.service');

// Routes
const routes = require("./routes");
const userController = require("./controllers/user.controller");

// Sockets
const { initializeSocketEvents } = require("./sockets/whatsapp.socket");

// Services
const userService = require("./services/user.service");
const whatsappService = require("./services/whatsapp.service");

// Middlewares
const { errorHandler } = require("./middlewares/error.middleware");

const PORT = process.env.PORT || 4010;

/**
 * Inicializa el servidor
 */
async function startServer() {
    try {
        console.log("🚀 Iniciando servidor...");

        // 1. Conectar a MongoDB
        await connectToMongoDB();
        // await connectMongoose();

        // 2. Configurar Express
        const app = setupExpressApp();

        // 3. Crear servidor HTTP
        const server = http.createServer(app);

        // 4. Inicializar Socket.IO
        const io = socketIO(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        socketService.setIO(io); // ← IMPORTANTE: Configurar primero
        await whatsappService.killZombieProcesses();
        initializeSocketEvents(io);
        console.log("✅ Socket.IO inicializado");

        // 5. Configurar rutas
        // Ruta especial para escanear QR (debe ir antes de /api)
        app.get("/scan", userController.scanQR);

        // Rutas de API
        app.use("/api", routes);

        // Ruta de prueba
        app.get("/", (req, res) => {
            res.send("WhatsApp API Server Running ✅");
        });

        // Middleware de manejo de errores (debe ir al final)
        app.use(errorHandler);

        // 6. Cargar usuarios existentes y reconectar
        console.log("🔄 Reconectando sesiones existentes...");
        const users = await userService.getAllUsers();

        if (users && users.length > 0) {
            const SESSION_READY_TIMEOUT = 120000; // 2 minutos
            const DELAY_BETWEEN_SESSIONS = 10000; // 10 segundos entre sesiones

            const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            // Función que espera al estado 'ready'
            const waitForReady = (userId, timeout = SESSION_READY_TIMEOUT) => {
                return new Promise((resolve) => {
                    const startTime = Date.now();

                    const checkInterval = setInterval(() => {
                        const sessionStatus = whatsappService.getSessionStatus(userId);
                        
                        console.log(sessionStatus)
                        // ⭐ Usar la función del servicio
                        const elapsed = Date.now() - startTime;

                        if (!sessionStatus) {
                            // La sesión no existe aún
                            if (elapsed >= timeout) {
                                clearInterval(checkInterval);
                                resolve('timeout');
                            }
                            return;
                        }

                        // ✅ Llegó a ready
                        if (sessionStatus.status === 'ready') {
                            clearInterval(checkInterval);
                            console.log(`✅ ${userId} READY en ${Math.round(elapsed / 1000)}s`);
                            resolve('ready');
                        }

                        // 📱 Generó QR (no tiene sesión)
                        else if (sessionStatus.qr || sessionStatus.status === 'initialized') {
                            clearInterval(checkInterval);
                            console.log(`📱 ${userId} requiere QR, continuando...`);
                            resolve('qr');
                        }

                        // ⏱️ Timeout
                        else if (elapsed >= timeout) {
                            clearInterval(checkInterval);
                            console.warn(`⏱️ TIMEOUT: ${userId} quedó en estado '${sessionStatus.status}'`);
                            resolve('timeout');
                        }
                    }, 3000); // Verificar cada 3 segundos
                });
            };

            let readyCount = 0;
            let qrCount = 0;
            let timeoutCount = 0;

            for (let i = 0; i < users.length; i++) {
                const user = users[i];

                try {
                    console.log(`\n🔌 [${i + 1}/${users.length}] Conectando ${user.id_externo}...`);

                    // Iniciar conexión (no esperar a que termine initialize)
                    whatsappService.connectToWhatsApp(
                        user.id_externo,
                        user.receive_messages
                    ).catch(err => {
                        console.error(`❌ Error en connectToWhatsApp para ${user.id_externo}:`, err.message);
                    });

                    // ⭐ Esperar a que llegue a ready, genere QR, o timeout
                    const result = await waitForReady(user.id_externo);

                    if (result === 'ready') {
                        readyCount++;
                    } else if (result === 'qr') {
                        qrCount++;
                    } else if (result === 'timeout') {
                        timeoutCount++;
                    }

                } catch (error) {
                    console.error(`⚠️ Error procesando ${user.id_externo}:`, error.message);
                    timeoutCount++;
                }

                // Pausa entre sesiones
                if (i < users.length - 1) {
                    console.log(`⏸️ Esperando ${DELAY_BETWEEN_SESSIONS / 1000}s antes de la siguiente...`);
                    await wait(DELAY_BETWEEN_SESSIONS);
                }
            }

            console.log(`\n📊 RESUMEN DE RECONEXIÓN:`);
            console.log(`✅ Sesiones READY: ${readyCount}`);
            console.log(`📱 Sesiones esperando QR: ${qrCount}`);
            console.log(`⏱️ Sesiones con timeout: ${timeoutCount}`);
            console.log(`📝 Total procesadas: ${users.length}`);

        } else {
            console.log("ℹ️ No hay sesiones para reconectar");
        }

        // 7. Iniciar servidor
        server.listen(PORT, () => {
            console.log(`✅ Servidor corriendo en puerto ${PORT}`);
            console.log(`🌐 URL: http://localhost:${PORT}`);
        });

        // 8. Manejo de señales de cierre
        process.on("SIGTERM", gracefulShutdown);
        process.on("SIGINT", gracefulShutdown);

        process.on('unhandledRejection', (reason, promise) => {
            // Ignorar errores EBUSY de WhatsApp
            if (reason?.message?.includes('EBUSY') && reason?.message?.includes('chrome_debug.log')) {
                console.warn('⚠️ Error EBUSY ignorado (archivos de Chrome en uso, se limpiarán luego)');
                return;
            }

            // Ignorar errores de Puppeteer después de cerrar
            if (reason?.message?.includes('Session closed') ||
                reason?.message?.includes('Protocol error')) {
                console.warn('⚠️ Error de Puppeteer ignorado (sesión cerrada)');
                return;
            }

            // Otros errores sí se reportan
            console.error('❌ Unhandled Rejection:', reason);
        });

        process.on('uncaughtException', (error) => {
            // Ignorar EBUSY
            if (error?.message?.includes('EBUSY') && error?.message?.includes('chrome_debug.log')) {
                console.warn('⚠️ Error EBUSY ignorado (archivos en uso)');
                return;
            }

            // Ignorar errores de Puppeteer
            if (error?.message?.includes('Session closed') ||
                error?.message?.includes('Protocol error')) {
                console.warn('⚠️ Error de Puppeteer ignorado');
                return;
            }

            // Otros errores sí son críticos
            console.error('❌ Uncaught Exception:', error);
            process.exit(1);
        });

        async function gracefulShutdown() {
            console.log("\n🛑 Cerrando servidor...");

            server.close(async () => {
                console.log("✅ Servidor HTTP cerrado");

                // Cerrar conexiones de base de datos
                await closeConnections();

                console.log("👋 Servidor cerrado completamente");
                process.exit(0);
            });

            // Forzar cierre después de 10 segundos
            setTimeout(() => {
                console.error("⚠️ Forzando cierre del servidor");
                process.exit(1);
            }, 10000);
        }
    } catch (error) {
        console.error("❌ Error iniciando servidor:", error);
        process.exit(1);
    }
}

// Iniciar servidor
startServer();