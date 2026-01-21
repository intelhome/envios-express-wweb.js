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
            const DELAY_BETWEEN_SESSIONS = 5000;

            for (let i = 0; i < users.length; i++) {
                const user = users[i];

                try {
                    console.log(`\n[${i + 1}/${users.length}] Conectando ${user.id_externo}...`);

                    await whatsappService.connectToWhatsApp(
                        user.id_externo,
                        user.receive_messages
                    );

                } catch (error) {
                    console.error(`⚠️ Error reconectando ${user.id_externo}:`, error.message);
                }

                // Pausa entre sesiones
                if (i < users.length - 1) {
                    await new Promise(r => setTimeout(r, DELAY_BETWEEN_SESSIONS));
                }
            }

            console.log(`\n✅ ${users.length} sesiones procesadas`);
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