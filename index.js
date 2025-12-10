const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const moment = require("moment-timezone");
const { MongoClient } = require("mongodb");
const mongoose = require("mongoose");
const fs = require("fs-extra");
const app = require("express")();
const path = require("path");
const { MessageMedia } = require("whatsapp-web.js");
const https = require("https");
const http = require("http");

require("dotenv").config();

const connectToMongoDB = require("./functions/connect-mongodb");
const connectMongoose = require("./functions/connect-mongoose");

app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "client")));

const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 4010;

// Variables para el sock
let db;
let whatsapp_registros;
let WhatsAppSessions = {};

// Trackear sockets de usuarios
global.io = io;
if (!global.userSockets) {
  global.userSockets = {};
}

io.on("connection", (socket) => {
  console.log("📡 Socket conectado:", socket.id);

  socket.on("joinSession", async (id_externo) => {
    console.log(`👤 Usuario ${id_externo} se unió con socket: ${socket.id}`);

    // Verificar si ya existe un socket para este usuario
    const oldSocketId = global.userSockets[id_externo];
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
    global.userSockets[id_externo] = socket.id;
    socket.data.id_externo = id_externo; // Guardar id_externo en el socket

    // Unir a una sala específica
    socket.join(id_externo);

    // Verificar sesión en memoria
    const session = WhatsAppSessions[id_externo];

    if (session) {
      if (session.qrCode) {
        // Tiene QR pendiente
        socket.emit("qr", session.qrCode);
        socket.emit("log", "QR pendiente de escaneo");
      } else if (session.connectedAt) {
        // Ya está conectado
        socket.emit("qrstatus", "/assets/check.svg");
        socket.emit("log", "Usuario conectado");

        // Enviar info del usuario
        try {
          const user = await getUserRecordByIdExterno(id_externo);
          if (user) {
            const userinfo = `${user.id_externo} ${user.nombre}`;
            socket.emit("user", userinfo);
          }
        } catch (error) {
          console.error("Error obteniendo info de usuario:", error);
        }
      }
    } else {
      // No hay sesión en memoria, verificar en BD
      try {
        const sessionInDB = await mongoose.connection.db
          .collection("whatsapp_sessions")
          .findOne({ session: id_externo });

        if (sessionInDB) {
          socket.emit("qrstatus", "/assets/loader.gif");
          socket.emit("log", "Restaurando sesión...");

          // Reconectar la sesión
          console.log(`🔄 Restaurando sesión para: ${id_externo}`);
          connectToWhatsApp(id_externo, receiveMessages).catch((err) => {
            console.error(`Error restaurando sesión para ${id_externo}:`, err);
            socket.emit("log", "Error al restaurar sesión");
          });
        } else {
          socket.emit(
            "log",
            "Sin sesión activa. Inicia sesión escaneando el QR."
          );
        }
      } catch (error) {
        console.error("Error verificando sesión en BD:", error);
      }
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`🔌 Socket desconectado: ${socket.id} - Razón: ${reason}`);

    // Limpiar el socket del usuario
    const id_externo = socket.data.id_externo;

    if (id_externo && global.userSockets[id_externo] === socket.id) {
      // Solo eliminar si es el socket actual del usuario
      delete global.userSockets[id_externo];
      console.log(`🗑️ Socket limpiado para usuario: ${id_externo}`);
    }
  });

  // Evento personalizado para refrescar estado
  socket.on("requestStatus", async (id_externo) => {
    console.log(`📊 Usuario ${id_externo} solicita estado actual`);

    const session = WhatsAppSessions[id_externo];

    if (session?.connectedAt) {
      socket.emit("qrstatus", "/assets/check.svg");
      socket.emit("log", "Conectado");
    } else if (session?.qrCode) {
      socket.emit("qr", session.qrCode);
      socket.emit("log", "QR pendiente");
    } else {
      socket.emit("log", "Sin conexión activa");
    }
  });
});

/* Endpoint para crear un nuevo usuario */
app.post("/crear-usuario", async (req, res) => {
  const { nombre, id_externo, descripcion, receive_messages } = req.body;

  try {
    const registroExistente = await getUserRecordByIdExterno(id_externo);

    if (!registroExistente) {
      if (nombre && id_externo && typeof receive_messages === "boolean") {
        const registros = db.collection("registros_whatsapp");
        const nuevoRegistro = {
          nombre,
          id_externo,
          descripcion,
          fechaCreacion: new Date(),
          receive_messages,
        };

        await registros.insertOne(nuevoRegistro);

        await connectToWhatsApp(id_externo, receive_messages);

        res.json({
          result: true,
          success: "Usuario creado correctamente",
          registro: nuevoRegistro,
        });
      } else {
        res.status(400).send({
          result: false,
          error:
            "Por favor, proporciona un nombre, un identificador y especifica si deseas enviar y recibir mensajes.",
        });
      }
    } else {
      res.status(400).send({
        result: false,
        error: "Ya existe un registro con el mismo identificador",
      });
    }
  } catch (err) {
    console.error("Error detallado:", err);
    res.status(500).json({
      result: false,
      error: `Error al crear registro: ${err.message}`,
    });
  }
});

/* Endpoint para escanear el QR */
app.get("/scan", async (req, res) => {
  const { id_externo } = req.query;

  if (!id_externo) {
    return res.status(400).send("ID externo es necesario");
  }

  try {
    const userRecord = await getUserRecordByIdExterno(id_externo);

    if (!userRecord) {
      return res.status(404).send("Registro no encontrado");
    }

    res.sendFile(path.join(__dirname, "client", "index.html"));
  } catch (error) {
    console.error("Error al obtener registros:", error);
    return res.status(500).send("Error interno del servidor");
  }
});

/* Endpoint para revisar los registros creados */
app.get("/registros", async (req, res) => {
  try {
    const registros = await getUserRecords();

    // Filtramos los campos '_id' y 'qr' del resultado
    const registrosFiltrados = registros.map((registro) => {
      const { _id, qr, ...registroSinIdYQR } = registro;
      return registroSinIdYQR;
    });

    console.log(
      `---------------------------------- Registros Encontrados ----------------------------------`
    );
    res.json({
      result: true,
      success: "datos obtenidos",
      data: registrosFiltrados,
    });
  } catch (err) {
    console.error("********************* Error al obtener registros:", err);
    res.status(500).json({
      result: false,
      success: "",
      error: "Error al obtener registros",
    });
  }
});

/* Endpoint para mostrar la información del usuario */
app.get("/view-user/:id_externo", async (req, res) => {
  const { id_externo } = req.params;

  try {
    console.log(`📋 Solicitando información del usuario: ${id_externo}`);

    // Verificar si existe la sesión
    const session = WhatsAppSessions[id_externo];

    if (!session) {
      console.log(`⚠️ No existe sesión para: ${id_externo}`);
      return res.status(404).json({
        result: false,
        status: false,
        response: "No existe una sesión para este usuario",
      });
    }

    const client = session.client;

    // Verificar si está conectado
    const state = await client.getState().catch(() => null);

    if (state !== "CONNECTED") {
      console.log(`⚠️ Cliente no conectado: ${id_externo} - Estado: ${state}`);
      return res.status(500).json({
        result: false,
        status: false,
        response: "Aún no estás conectado",
        state: state || "DISCONNECTED",
      });
    }

    // Obtener información del usuario
    const info = await client.info;

    // Extraer datos
    const userId = info.wid._serialized; // Número completo con @c.us
    const userName = info.pushname || info.wid.user; // Nombre o número
    const phoneNumber = info.wid.user; // Solo el número sin @c.us

    console.log(`✅ \nInformación del usuario ${id_externo} entregada`);
    console.log(`   - ID: ${userId}`);
    console.log(`   - Nombre: ${userName}`);
    console.log(`   - Teléfono: ${phoneNumber}`);

    res.json({
      result: true,
      status: true,
      userId: userId,
      userName: userName,
      phoneNumber: phoneNumber,
      connectedAt: session.connectedAt,
      state: state,
    });
  } catch (err) {
    console.error(`❌ Error obteniendo info del usuario ${id_externo}:`, err);
    res.status(500).json({
      result: false,
      status: false,
      response: "Error al obtener información del usuario",
      error: err.message,
    });
  }
});

/* Endpoint para eliminar un usuario */
app.delete("/eliminar-usuario/:id_externo", async (req, res) => {
  const { id_externo } = req.params;

  try {
    const registros = await getUserRecords();

    if (!registros) {
      return res.status(400).json({
        result: false,
        error: "No existen aun registros",
      });
    }

    if (id_externo) {
      // Solo llama a logoutWhatsApp
      // El evento 'disconnected' se encargará de llamar removeRegistro()
      const result = await logoutWhatsApp(id_externo);

      console.log(
        `---------------------------------- SE ELIMINARON LAS FUNCIONES PARA ${id_externo} ----------------------------------`
      );

      res.json({
        result: true,
        id: id_externo,
        success: "Registro eliminado correctamente",
        error: "",
      });
    } else {
      res.status(400).json({
        result: false,
        success: "",
        error: "Debe especificar el id_externo del usuario.",
      });
    }
  } catch (err) {
    console.error("Error detallado:", err);
    res.status(500).json({
      result: false,
      error: `Error al eliminar el registro: ${err.message}`,
    });
  }
});

/* Endpoint para cerrar sesión de forma segura */
app.post("/logout/:id_externo", async (req, res) => {
  try {
    const { id_externo } = req.params;
    const result = await logoutWhatsApp(id_externo);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/* Endpoint para realizar el envio de mensajes con opciones avanzadas */
app.post("/send-message/:id_externo", async (req, res) => {
  const { id_externo } = req.params;
  const {
    number,
    message,
    tempMessage, // Compatibilidad con versión anterior
    pdfBase64,
    imageBase64,
    mediaType, // 'pdf', 'image', 'video', 'audio'
    fileName,
    caption,
  } = req.body;

  try {
    const messageText = message || tempMessage;

    // Validaciones
    if (!number) {
      return res.status(400).json({
        status: false,
        response: "El número es requerido",
      });
    }

    if (!messageText && !pdfBase64 && !imageBase64) {
      return res.status(400).json({
        status: false,
        response: "Debes proporcionar un mensaje o archivo",
      });
    }

    // Obtener cliente
    const session = WhatsAppSessions[id_externo];

    if (!session?.client) {
      return res.status(404).json({
        status: false,
        response: "No existe una sesión activa para este usuario",
        hint: "Inicia sesión primero escaneando el QR",
      });
    }

    const client = session.client;

    // Verificar estado
    const state = await client.getState();

    if (state !== "CONNECTED") {
      return res.status(503).json({
        status: false,
        response: `Cliente no conectado. Estado: ${state}`,
        state: state,
      });
    }

    // Formatear número
    let formattedNumber = String(number || "").replace(/[^\d]/g, "");

    // Validar que no esté vacío después de formatear
    if (!formattedNumber) {
      return res.status(400).json({
        status: false,
        response: "Número de teléfono inválido o no proporcionado",
      });
    }

    // Agregar código de país si es necesario (Ecuador = 593)
    if (formattedNumber.length === 10 && !formattedNumber.startsWith("593")) {
      formattedNumber = "593" + formattedNumber;
    } else if (
      formattedNumber.length === 9 &&
      !formattedNumber.startsWith("593")
    ) {
      formattedNumber = "593" + formattedNumber;
    }

    const chatId = formattedNumber + "@c.us";

    // Verificar registro en WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);

    if (!isRegistered) {
      return res.status(404).json({
        status: false,
        response: "El número no está registrado en WhatsApp",
        number: formattedNumber,
      });
    }

    // Enviar mensaje
    let result;

    try {
      if (pdfBase64 || imageBase64) {
        // Determinar tipo de media
        let mimeType, base64Data, defaultFileName;

        if (pdfBase64) {
          mimeType = "application/pdf";
          base64Data = pdfBase64;
          defaultFileName = "documento.pdf";
        } else if (imageBase64) {
          mimeType = mediaType === "image" ? "image/jpeg" : "image/png";
          base64Data = imageBase64;
          defaultFileName = "imagen.jpg";
        }

        const media = new MessageMedia(
          mimeType,
          base64Data,
          fileName || defaultFileName
        );

        result = await client.sendMessage(chatId, media, {
          caption: caption || messageText || "",
        });

        console.log(`📎 Archivo enviado a ${formattedNumber}`);
      } else {
        // Solo texto
        result = await client.sendMessage(chatId, messageText);
        console.log(`💬 Mensaje enviado a ${formattedNumber}`);
      }

      // Información de respuesta
      const info = client.info;
      const fechaServidor = moment()
        .tz("America/Guayaquil")
        .format("YYYY-MM-DD HH:mm:ss");

      console.log({
        De: `cliente-${id_externo}`,
        Para: formattedNumber,
        EnviadoPor: info.wid.user,
        Message: messageText,
        Fecha: fechaServidor,
        MessageId: result.id._serialized,
      });

      // Esperar confirmación de envío (opcional)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return res.status(200).json({
        status: true,
        response: {
          messageId: result.id._serialized,
          timestamp: result.timestamp,
          senderNumber: info.wid.user,
          recipientNumber: formattedNumber,
          ack: result.ack, // 0: Error, 1: Enviado, 2: Recibido, 3: Leído
          ackName: getAckStatus(result.ack),
          fecha: fechaServidor,
        },
      });
    } catch (sendError) {
      console.error("Error enviando mensaje:", sendError);

      // Errores específicos
      if (sendError.message.includes("Evaluation failed")) {
        return res.status(500).json({
          status: false,
          response: "Error al procesar el mensaje. Verifica el formato",
        });
      }

      if (sendError.message.includes("Phone not connected")) {
        return res.status(503).json({
          status: false,
          response: "Teléfono desconectado. Reconecta el dispositivo",
        });
      }

      throw sendError;
    }
  } catch (error) {
    console.error("Error general en send-message:", error);
    return res.status(500).json({
      status: false,
      response: error.message || "Error interno del servidor",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/* Enviar mensajes Multimedia (image, video, audio, location, document) */
app.post("/send-message-media/:id_externo", async (req, res) => {
  const { number, tempMessage, link, type, latitud, longitud, file } = req.body;
  const { id_externo } = req.params;

  try {
    // Validación del número
    if (!number) {
      return res.status(400).json({
        status: false,
        response: "El número es requerido",
      });
    }

    // Obtener sesión del cliente
    const session = WhatsAppSessions[id_externo];

    if (!session?.client) {
      return res.status(404).json({
        status: false,
        response: "No existe una sesión activa para este usuario",
        hint: "Inicia sesión primero escaneando el QR",
      });
    }

    const client = session.client;

    // Verificar estado de conexión
    const state = await client.getState();

    if (state !== "CONNECTED") {
      return res.status(503).json({
        status: false,
        response: `Cliente no conectado. Estado: ${state}`,
        state: state,
      });
    }

    // Formatear número
    let formattedNumber = number.replace(/[^\d]/g, "");

    // Agregar código de país Ecuador (593) si es necesario
    if (formattedNumber.length === 10 && !formattedNumber.startsWith("593")) {
      formattedNumber = "593" + formattedNumber;
    } else if (
      formattedNumber.length === 9 &&
      !formattedNumber.startsWith("593")
    ) {
      formattedNumber = "593" + formattedNumber;
    }

    const chatId = formattedNumber + "@c.us";

    // Verificar si el número está registrado en WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);

    if (!isRegistered) {
      return res.status(404).json({
        status: false,
        response: "El número no está registrado en WhatsApp",
        number: formattedNumber,
      });
    }

    let result;
    const fechaServidor = moment()
      .tz("America/Guayaquil")
      .format("YYYY-MM-DD HH:mm:ss");

    // Procesar según el tipo de mensaje
    switch (type) {
      case "image":
        try {
          const imageMedia = await MessageMedia.fromUrl(link);
          result = await client.sendMessage(chatId, imageMedia, {
            caption: tempMessage || "",
          });

          console.log(`🖼️ Imagen enviada a ${formattedNumber}`);
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: "Error al enviar imagen",
            error: err.message,
          });
        }
        break;

      case "video":
        try {
          const videoMedia = await MessageMedia.fromUrl(link);
          result = await client.sendMessage(chatId, videoMedia, {
            caption: tempMessage || "",
            sendMediaAsDocument: false,
          });

          console.log(`🎥 Video enviado a ${formattedNumber}`);
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: "Error al enviar video",
            error: err.message,
          });
        }
        break;

      case "audio":
        try {
          const audioMedia = await MessageMedia.fromUrl(link);
          // Para enviar como nota de voz, usar sendMediaAsDocument: false
          result = await client.sendMessage(chatId, audioMedia, {
            sendAudioAsVoice: true, // Enviar como nota de voz
          });

          console.log(`🎵 Audio enviado a ${formattedNumber}`);
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: "Error al enviar audio",
            error: err.message,
          });
        }
        break;

      case "location":
        try {
          const location = new Location(latitud, longitud, tempMessage || "");
          result = await client.sendMessage(chatId, location);

          console.log(`📍 Ubicación enviada a ${formattedNumber}`);
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: "Error al enviar ubicación",
            error: err.message,
          });
        }
        break;

      case "document":
        try {
          const pathname = new URL(link).pathname;
          const nombreArchivo = decodeURIComponent(
            pathname.substring(pathname.lastIndexOf("/") + 1)
          );

          const documentMedia = await MessageMedia.fromUrl(link);
          documentMedia.filename = nombreArchivo;

          result = await client.sendMessage(chatId, documentMedia, {
            caption: tempMessage || "",
            sendMediaAsDocument: true,
          });

          console.log(`📄 Documento enviado a ${formattedNumber}`);
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: "Error al enviar documento",
            error: err.message,
          });
        }
        break;

      case "documentBase64":
        try {
          const pdfMedia = new MessageMedia(
            "application/pdf",
            link, // Base64 string
            `${file || "documento"}.pdf`
          );

          result = await client.sendMessage(chatId, pdfMedia, {
            caption: tempMessage || "",
            sendMediaAsDocument: true,
          });

          console.log(`📎 PDF Base64 enviado a ${formattedNumber}`);
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: "Error al enviar PDF Base64",
            error: err.message,
          });
        }
        break;

      default:
        // Enviar mensaje de texto
        try {
          result = await client.sendMessage(chatId, tempMessage);
          console.log(`💬 Mensaje de texto enviado a ${formattedNumber}`);
        } catch (err) {
          return res.status(500).json({
            status: false,
            response: "Error al enviar mensaje de texto",
            error: err.message,
          });
        }
        break;
    }

    // Obtener información del cliente
    const info = client.info;

    // Log del mensaje enviado
    console.log({
      De: `cliente-${id_externo}`,
      Para: formattedNumber,
      EnviadoPor: info.wid.user,
      Message: tempMessage,
      Tipo: type,
      Fecha: fechaServidor,
      MessageId: result.id._serialized,
    });

    // Esperar un momento para que se procese el envío
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Respuesta exitosa
    return res.status(200).json({
      status: true,
      response: {
        messageId: result.id._serialized,
        timestamp: result.timestamp,
        senderNumber: info.wid.user,
        recipientNumber: formattedNumber,
        type: type,
        ack: result.ack,
        ackName: getAckStatus(result.ack),
        fecha: fechaServidor,
      },
    });
  } catch (error) {
    console.error("Error general en send-message-media:", error);
    return res.status(500).json({
      status: false,
      response: error.message || "Error interno del servidor",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * Obtener el nombre del estado de ACK
 */
function getAckStatus(ack) {
  const statuses = {
    "-1": "Error",
    0: "Pendiente",
    1: "Enviado",
    2: "Recibido por servidor",
    3: "Recibido por destinatario",
    4: "Leído",
    5: "Reproducido",
  };
  return statuses[ack] || "Desconocido";
}

async function removeRegistro(id_externo) {
  try {
    console.log(`🗑️ Eliminando registro para: ${id_externo}`);

    // 1. Eliminar de la colección de registros de usuarios
    const deleteResult = await whatsapp_registros.deleteOne({
      id_externo: id_externo,
    });

    if (deleteResult.deletedCount > 0) {
      console.log(`✅ Registro eliminado de whatsapp_registros: ${id_externo}`);
    }

    // 2. Eliminar la sesión de MongoDB (RemoteAuth)
    const sessionResult = await mongoose.connection.db
      .collection("whatsapp_sessions")
      .deleteOne({ session: id_externo });

    if (sessionResult.deletedCount > 0) {
      console.log(`✅ Sesión eliminada de MongoDB: ${id_externo}`);
    }

    // 3. Manejar cliente en memoria
    if (WhatsAppSessions[id_externo]) {
      const session = WhatsAppSessions[id_externo];
      const client = session.client;

      // Destruir el cliente si existe y está activo
      if (client) {
        try {
          const state = await client.getState().catch(() => null);

          if (state) {
            console.log(`🔌 Estado del cliente antes de destruir: ${state}`);
            await client.destroy();
            console.log(`✅ Cliente destruido: ${id_externo}`);
          } else {
            console.log(`⚠️ Cliente ya estaba destruido: ${id_externo}`);
          }
        } catch (error) {
          if (
            error.message.includes("Session closed") ||
            error.message.includes("Target closed")
          ) {
            console.log(
              `⚠️ Cliente ya fue destruido previamente: ${id_externo}`
            );
          } else {
            console.error(
              `Error destruyendo cliente ${id_externo}:`,
              error.message
            );
          }
        }
      }

      // Limpiar de memoria
      delete WhatsAppSessions[id_externo];
      console.log(`✅ Sesión eliminada de memoria: ${id_externo}`);
    }

    // 4. Eliminar archivos físicos de .wwebjs_auth
    try {
      const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-${id_externo}`);

      // Verificar si existe el directorio
      try {
        await fs.access(sessionPath);
        // Si existe, eliminarlo recursivamente
        await fs.rm(sessionPath, { recursive: true, force: true });
        console.log(`✅ Archivos de sesión eliminados: ${sessionPath}`);
      } catch (err) {
        // No existe o ya fue eliminado
        console.log(`⚠️ No se encontraron archivos de sesión en: ${sessionPath}`);
      }
    } catch (error) {
      console.error(`❌ Error eliminando archivos de sesión:`, error.message);
    }

    // 5. Limpiar socket del usuario
    if (global.userSockets && global.userSockets[id_externo]) {
      const socketId = global.userSockets[id_externo];
      const userSocket = global.io?.sockets.sockets.get(socketId);

      if (userSocket) {
        userSocket.emit("log", "Sesión cerrada y eliminada");
        userSocket.emit("qrstatus", "/assets/disconnected.svg");
      }

      delete global.userSockets[id_externo];
      console.log(`✅ Socket limpiado: ${id_externo}`);
    }

    console.log(`✅ Registro completamente eliminado: ${id_externo}`);
    return true;
  } catch (error) {
    console.error(`❌ Error eliminando registro ${id_externo}:`, error);
    return false;
  }
}

async function cleanupSessionFiles(id_externo) {
  try {
    console.log(`🗑️ Limpiando archivos de sesión para: ${id_externo}`);

    // Rutas específicas de ESTA sesión
    const authPath = path.join(
      __dirname,
      ".wwebjs_auth",
      `session-${id_externo}`
    );
    const cachePath = path.join(
      __dirname,
      ".wwebjs_cache",
      `session-${id_externo}`
    );

    let deletedAuth = false;
    let deletedCache = false;

    // Eliminar SOLO la carpeta de esta sesión en auth
    if (await fs.pathExists(authPath)) {
      await fs.remove(authPath);
      deletedAuth = true;
      console.log(`✅ Sesión eliminada de auth: ${authPath}`);
    } else {
      console.log(`ℹ️ No existe sesión en auth: ${authPath}`);
    }

    // Eliminar SOLO la carpeta de esta sesión en cache
    if (await fs.pathExists(cachePath)) {
      await fs.remove(cachePath);
      deletedCache = true;
      console.log(`✅ Sesión eliminada de cache: ${cachePath}`);
    } else {
      console.log(`ℹ️ No existe sesión en cache: ${cachePath}`);
    }

    // Resumen
    if (deletedAuth || deletedCache) {
      console.log(
        `✅ Archivos de sesión ${id_externo} eliminados exitosamente`
      );
      return { success: true, message: "Archivos de sesión eliminados" };
    } else {
      console.log(`⚠️ No se encontraron archivos para eliminar: ${id_externo}`);
      return { success: true, message: "No había archivos para eliminar" };
    }
  } catch (error) {
    console.error(
      `❌ Error limpiando archivos de sesión para ${id_externo}:`,
      error
    );
    return { success: false, message: error.message };
  }
}

// async function connectToWhatsApp(id_externo, receiveMessages) {
//   try {
//     const client = new Client({
//       authStrategy: new LocalAuth({ clientId: id_externo }),
//       puppeteer: {
//         headless: true,
//         executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
//         args: [
//           "--no-sandbox",
//           "--disable-setuid-sandbox",
//           "--disable-dev-shm-usage",
//           "--disable-gpu",
//           "--disable-extensions",
//           "--disable-infobars",
//           "--window-size=1920,1080",
//           "--disable-background-timer-throttling",
//           "--disable-backgrounding-occluded-windows",
//           "--disable-renderer-backgrounding",
//         ],
//       },
//       qrMaxRetries: 5,
//       authTimeoutMs: 0,
//       qrTimeoutMs: 0,
//       restartOnAuthFail: true,
//       takeoverOnConflict: false,
//       takeoverTimeoutMs: 0,
//       webVersionCache: {
//         type: "remote",
//         remotePath:
//           "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
//       },
//     });

//     // ============================================
//     // EVENTOS DEL CLIENTE
//     // ============================================
//     // QR Code
//     client.on("qr", async (qr) => {
//       console.log(`📱 QR Code generado para: ${id_externo}`);

//       const QRCode = require("qrcode");
//       const qrCodeData = await QRCode.toDataURL(qr);

//       // Actualizar en DB y enviar por socket
//       await updateQR("qr", id_externo, qrCodeData);

//       // Actualizar en DB
//       await updateConnectionStatus(id_externo, "qr", null, qrCodeData);

//       WhatsAppSessions[id_externo] = {
//         client: client,
//         connectedAt: null,
//         qrGeneratedAt: Date.now(),
//         qrCode: qrCodeData,
//       };
//     });

//     // Autenticación exitosa
//     client.on("authenticated", async () => {
//       console.log(`✅ Autenticado: ${id_externo}`);
//       await updateUserRecord(id_externo, { estado: "autenticado" });
//     });

//     // Listo para usar
//     client.on("ready", async () => {
//       console.log(`✔️ Cliente listo: ${id_externo}`);

//       await updateUserRecord(id_externo, { estado: "conectado" });
//       await updateQR("connected", id_externo);

//       WhatsAppSessions[id_externo] = {
//         client: client,
//         connectedAt: Date.now(),
//         qrGeneratedAt: null,
//         qrCode: null,
//       };
//     });

//     // Desconexión
//     client.on("disconnected", async (reason) => {
//       console.log(`❌ Desconectado ${id_externo}:`, reason);

//       await updateConnectionStatus(id_externo, "close", reason, null);

//       // Limpiar sesión de memoria (sin destruir el cliente, ya está desconectado)
//       if (WhatsAppSessions[id_externo]) {
//         delete WhatsAppSessions[id_externo];
//         console.log(`✅ Sesión eliminada de memoria: ${id_externo}`);
//       }

//       const shouldReconnect =
//         reason !== "LOGOUT" &&
//         reason !== "Max qrcode retries reached" &&
//         reason !== "NAVIGATION";

//       // Reconectar si no fue logout
//       if (shouldReconnect) {
//         // Casos de desconexión temporal (internet, conflicto, etc.)
//         console.log(`🔄 Reconectando en 5s para: ${id_externo}`);
//         setTimeout(() => {
//           connectToWhatsApp(id_externo, receiveMessages);
//         }, 5000);
//       } else {
//         console.log(`🗑️ Logout detectado, eliminando datos: ${id_externo}`);

//         try {
//           await removeRegistro(id_externo);
//           await cleanupSessionFiles(id_externo);

//           // Limpiar socket
//           if (global.userSockets && global.userSockets[id_externo]) {
//             const socketId = global.userSockets[id_externo];
//             const userSocket = global.io?.sockets.sockets.get(socketId);

//             if (userSocket) {
//               userSocket.emit("log", "Sesión cerrada correctamente");
//               userSocket.emit("qrstatus", "/assets/disconnected.svg");
//             }

//             delete global.userSockets[id_externo];
//             console.log(`✅ Socket limpiado: ${id_externo}`);
//           }
//         } catch (error) {
//           console.error(`Error en limpieza después de logout:`, error);
//         }
//       }
//     });

//     // Error de autenticación
//     client.on("auth_failure", async (msg) => {
//       console.error(`❌ Error de autenticación ${id_externo}:`, msg);
//       await updateUserRecord(id_externo, {
//         estado: "error_autenticacion",
//         error_msg: msg,
//       });

//       await removeRegistro(id_externo);
//     });

//     // ============================================
//     // RECEPCIÓN DE MENSAJES (NUEVA FUNCIONALIDAD)
//     // ============================================
//     if (receiveMessages) {
//       client.on("message", async (message) => {
//         await handleIncomingMessage(message, id_externo, client);
//       });

//       // Escuchar cambios en mensajes (ediciones, eliminaciones)
//       client.on("message_revoke_everyone", async (revokedMsg) => {
//         console.log(
//           `🗑️ Mensaje eliminado por el remitente: ${revokedMsg.id._serialized}`
//         );
//       });

//       // Escuchar cuando alguien está escribiendo
//       client.on("message_create", async (message) => {
//         // Este evento se dispara para TODOS los mensajes, incluso los que envías tú
//         // Útil si necesitas procesar también tus mensajes enviados
//         if (message.fromMe) {
//           console.log(`📤 Mensaje enviado por ti: ${message.body}`);
//         }
//       });

//       console.log(`📩 Recepción de mensajes activada para: ${id_externo}`);
//     }

//     // Inicializar cliente
//     // await client.initialize();
//     await Promise.race([
//       client.initialize(),
//       new Promise((_, reject) =>
//         setTimeout(
//           () => reject(new Error("Timeout inicializando cliente")),
//           120000
//         )
//       ),
//     ]);

//     return client;
//   } catch (error) {
//     console.error(`Error conectando WhatsApp para ${id_externo}:`, error);
//     throw error;
//   }
// }

async function connectToWhatsApp(id_externo, receiveMessages) {
  try {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: id_externo }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",

          // OPTIMIZACIONES CRÍTICAS DE MEMORIA
          "--disable-software-rasterizer",
          "--disable-extensions",
          "--disable-infobars",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-sync",
          "--disable-translate",
          "--disable-features=TranslateUI",
          "--disable-features=Translate",

          // Reducir uso de memoria
          "--single-process", // ⚠️ Menos estable pero usa MUCHA menos RAM
          "--no-zygote", // Reduce procesos hijo
          "--disable-accelerated-2d-canvas",
          "--disable-accelerated-jpeg-decoding",
          "--disable-accelerated-mjpeg-decode",
          "--disable-accelerated-video-decode",

          // Limitar recursos
          "--memory-pressure-off",
          "--max-old-space-size=512", // Limitar heap de V8 a 512MB por instancia

          // Ventana más pequeña = menos memoria
          "--window-size=800,600", // Era 1920x1080, esto ahorra mucho

          // Deshabilitar funciones innecesarias
          "--disable-default-apps",
          "--disable-domain-reliability",
          "--disable-background-networking",
          "--disable-breakpad",
          "--disable-component-extensions-with-background-pages",
          "--disable-features=AudioServiceOutOfProcess",
          "--disable-features=IsolateOrigins",
          "--disable-features=site-per-process",
          "--disable-ipc-flooding-protection",
          "--disable-hang-monitor",
          "--disable-prompt-on-repost",
          "--disable-client-side-phishing-detection",
          "--disable-notifications",
          "--disable-offer-store-unmasked-wallet-cards",
          "--disable-speech-api",
          "--hide-scrollbars",
          "--mute-audio",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dinosaur-easter-egg",
          "--disable-crash-reporter",
          "--disable-features=CalculateNativeWinOcclusion",
        ],

        // Limitar recursos adicionales
        defaultViewport: {
          width: 800,
          height: 600,
          deviceScaleFactor: 1,
        },

        // Timeout más agresivo
        timeout: 60000,
      },

      qrMaxRetries: 5,
      authTimeoutMs: 0,
      qrTimeoutMs: 0,
      restartOnAuthFail: true,
      takeoverOnConflict: false,
      takeoverTimeoutMs: 0,

      webVersionCache: {
        type: "remote",
        remotePath:
          "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
      },

      // NUEVO: Limitar caché
      userDataDir: `./sessions/${id_externo}`,
    });

    // ============================================
    // EVENTOS DEL CLIENTE (sin cambios)
    // ============================================

    client.on("qr", async (qr) => {
      console.log(`📱 QR Code generado para: ${id_externo}`);
      const QRCode = require("qrcode");
      const qrCodeData = await QRCode.toDataURL(qr);
      await updateQR("qr", id_externo, qrCodeData);
      await updateConnectionStatus(id_externo, "qr", null, qrCodeData);

      WhatsAppSessions[id_externo] = {
        client: client,
        connectedAt: null,
        qrGeneratedAt: Date.now(),
        qrCode: qrCodeData,
      };
    });

    client.on("authenticated", async () => {
      console.log(`✅ Autenticado: ${id_externo}`);
      await updateUserRecord(id_externo, { estado: "autenticado" });
    });

    client.on("ready", async () => {
      console.log(`✔️ Cliente listo: ${id_externo}`);
      await updateUserRecord(id_externo, { estado: "conectado" });
      await updateQR("connected", id_externo);

      WhatsAppSessions[id_externo] = {
        client: client,
        connectedAt: Date.now(),
        qrGeneratedAt: null,
        qrCode: null,
      };

      // NUEVO: Limpiar memoria después de conectar
      if (global.gc) {
        global.gc();
        console.log(`🧹 Garbage collection ejecutado para ${id_externo}`);
      }
    });

    client.on("disconnected", async (reason) => {
      console.log(`❌ Desconectado ${id_externo}:`, reason);
      await updateConnectionStatus(id_externo, "close", reason, null);

      if (WhatsAppSessions[id_externo]) {
        delete WhatsAppSessions[id_externo];
        console.log(`✅ Sesión eliminada de memoria: ${id_externo}`);
      }

      const shouldReconnect =
        reason !== "LOGOUT" &&
        reason !== "Max qrcode retries reached" &&
        reason !== "NAVIGATION";

      if (shouldReconnect) {
        console.log(`🔄 Reconectando en 5s para: ${id_externo}`);
        setTimeout(() => {
          connectToWhatsApp(id_externo, receiveMessages);
        }, 5000);
      } else {
        console.log(`🗑️ Logout detectado, eliminando datos: ${id_externo}`);
        try {
          await removeRegistro(id_externo);
          await cleanupSessionFiles(id_externo);

          if (global.userSockets && global.userSockets[id_externo]) {
            const socketId = global.userSockets[id_externo];
            const userSocket = global.io?.sockets.sockets.get(socketId);

            if (userSocket) {
              userSocket.emit("log", "Sesión cerrada correctamente");
              userSocket.emit("qrstatus", "/assets/disconnected.svg");
            }

            delete global.userSockets[id_externo];
            console.log(`✅ Socket limpiado: ${id_externo}`);
          }
        } catch (error) {
          console.error(`Error en limpieza después de logout:`, error);
        }
      }
    });

    client.on("auth_failure", async (msg) => {
      console.error(`❌ Error de autenticación ${id_externo}:`, msg);
      await updateUserRecord(id_externo, {
        estado: "error_autenticacion",
        error_msg: msg,
      });
      await removeRegistro(id_externo);
    });

    // ============================================
    // RECEPCIÓN DE MENSAJES CON OPTIMIZACIONES
    // ============================================
    if (receiveMessages) {
      client.on("message", async (message) => {
        await handleIncomingMessage(message, id_externo, client);
      });

      client.on("message_revoke_everyone", async (revokedMsg) => {
        console.log(`🗑️ Mensaje eliminado: ${revokedMsg.id._serialized}`);
      });

      console.log(`📩 Recepción de mensajes activada para: ${id_externo}`);
    }

    // Inicializar con timeout
    await Promise.race([
      client.initialize(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout inicializando cliente")),
          90000
        )
      ),
    ]);

    return client;
  } catch (error) {
    console.error(`Error conectando WhatsApp para ${id_externo}:`, error);
    throw error;
  }
}

// Función para manejar mensajes entrantes (equivalente a receiveMessages)
async function handleIncomingMessage(message, id_externo, client) {
  try {
    // Ignorar mensajes propios
    if (message.fromMe) {
      return;
    }

    // Ignorar mensajes de protocolo
    if (message.type === "protocol" || message.type === "ephemeral") {
      return;
    }

    // Obtener chat (esto sí funciona)
    const chat = await message.getChat();
    const isGroup = chat.isGroup;
    const senderJid = message.from;

    // Extraer número del remitente directamente del mensaje (más confiable)
    let senderNumber;

    if (isGroup) {
      // En grupos usar author
      senderNumber = (message.author || message.from)
        .replace("@c.us", "")
        .replace("@g.us", "");
    } else {
      // En mensajes directos usar from
      senderNumber = message.from.replace("@c.us", "").replace("@g.us", "");
    }

    // Validar número
    if (!senderNumber || senderNumber.includes("@")) {
      console.error("⚠️ Formato de número inválido:", senderNumber);
      return;
    }

    // Número del receptor
    const reciberNumber =
      client.info?.wid?.user || client.info?.me?.user || "desconocido";

    // Capturar contenido
    let captureMessage = "vacio";
    let base64Media = null;
    let mediaMimeType = null;
    let mediaFileName = null;
    let hasMediaContent = false;
    let originalWhatsAppMediaUrl =
      message._data?.deprecatedMms3Url || message._data?.clientUrl || null;

    if (message.hasMedia) {
      try {
        console.log(`[INFO] Descargando multimedia...`);
        const media = await message.downloadMedia();

        if (media) {
          base64Media = media.data;
          mediaMimeType = media.mimetype;

          const extension = mediaMimeType.split("/")[1]?.split(";")[0] || "bin";
          mediaFileName =
            media.filename ||
            message._data?.filename ||
            `${message.type}_${Date.now()}.${extension}`;

          hasMediaContent = true;
          console.log(
            `[INFO] Multimedia descargada correctamente. Tamaño: ${base64Media.length}`
          );
        }
      } catch (err) {
        console.error("[ERROR] Fallo al descargar media:", err);
        captureMessage += " [Error descargando archivo]";
      }
    }

    switch (message.type) {
      case "chat":
        captureMessage = message.body;
        break;
      case "image":
      case "video":
        captureMessage = message.caption || message.body || "";
        break;
      case "audio":
      case "ptt":
        captureMessage = "";
        break;
      case "document":
        captureMessage = message.caption || message.body || "";
        break;
      case "location":
        captureMessage = `[ubicación] ${message.body || ""}`;
        break;
      case "sticker":
        captureMessage = "[sticker]";
        break;
      default:
        captureMessage = message.body || `[${message.type}]`;
    }

    if (!captureMessage) captureMessage = "";

    const phoneNumber = senderNumber.replace(/\D/g, "");
    const isDirectMessage = !isGroup;

    console.log({
      tipo: isGroup ? "Grupo" : "Usuario",
      de: senderNumber,
      para: reciberNumber,
      mensaje: captureMessage.substring(0, 50), // Limitar log
      chat: senderJid,
    });

    // Solo procesar mensajes directos
    if (isDirectMessage && phoneNumber) {
      const data = JSON.stringify({
        empresa: "sigcrm_clinicasancho",
        name: phoneNumber,
        senderNumber: senderNumber,
        reciberNumber: reciberNumber,
        description: captureMessage,
        originalWhatsAppMediaUrl: originalWhatsAppMediaUrl || null,
        mediaDataBase64: base64Media || null,
        mediaMimeType: mediaMimeType || null,
        mediaFileName: mediaFileName || null,
        hasMediaContent: hasMediaContent,
      });

      const options = {
        hostname: "sigcrm.pro",
        path: "/response-baileys",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 10000, // Timeout de 10 segundos
      };

      const req = https.request(options, (res) => {
        let responseData = "";
        const startTime = Date.now();

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`✅ Webhook OK para ${phoneNumber}: ${res.statusCode}`);
          } else {
            console.warn(
              `⚠️ Webhook respondió ${res.statusCode} para ${phoneNumber}`
            );
          }
        });
      });

      req.on("error", (error) => {
        console.error("❌ Error enviando webhook:", error.message);
      });

      req.on("timeout", () => {
        console.error("❌ Timeout enviando webhook");
        req.destroy();
      });

      req.write(data);
      req.end();

      console.log(`📤 Mensaje procesado: ${phoneNumber}`);
    }
  } catch (error) {
    console.error("❌ Error procesando mensaje:", {
      error: error.message,
      stack: error.stack,
      from: message?.from,
      type: message?.type,
    });
  }
}

/**
 * Cierra sesión de WhatsApp de forma segura
 * @param {string} id_externo - ID del usuario
 */
async function logoutWhatsApp(id_externo) {
  try {
    console.log(`🚪 Cerrando sesión para: ${id_externo}`);

    const session = WhatsAppSessions[id_externo];

    if (!session || !session.client) {
      console.log(`⚠️ No hay sesión activa para: ${id_externo}`);
      // Limpiar directamente si no hay sesión
      await removeRegistro(id_externo);
      return {
        success: true,
        message: "No había sesión activa, limpieza completada",
      };
    }

    const client = session.client;

    try {
      const state = await client.getState();
      console.log(`Estado actual del cliente: ${state}`);

      if (state === "CONNECTED") {
        // IMPORTANTE: Primero destruir, LUEGO limpiar archivos
        await client.destroy(); // Esto cierra la conexión de forma segura
        console.log(`✅ Cliente destruido para: ${id_externo}`);

        // Ahora sí podemos limpiar todo
        await removeRegistro(id_externo);

        return { success: true, message: "Sesión cerrada correctamente" };
      } else {
        // Si no está conectado, limpiar manualmente
        console.log(`⚠️ Cliente no está conectado: ${state}`);
        await removeRegistro(id_externo);
        return { success: true, message: "Sesión limpiada" };
      }
    } catch (error) {
      console.error(`Error durante logout de ${id_externo}:`, error);
      // Si hay error, limpiar de todas formas
      await removeRegistro(id_externo);
      return { success: false, message: error.message };
    }
  } catch (error) {
    console.error(`Error en logoutWhatsApp para ${id_externo}:`, error);
    return { success: false, message: error.message };
  }
}

const updateQR = async (data, id_externo, qrData = null) => {
  // Buscar el socket del usuario específico
  const userSocket = global.io?.sockets.sockets.get(
    global.userSockets?.[id_externo]
  );

  switch (data) {
    case "qr":
      if (userSocket && qrData) {
        userSocket.emit("qr", qrData); // El QR ya viene en base64 desde wweb.js
        userSocket.emit("log", "QR recibido, escanea");
      } else {
        console.error(
          `Socket no encontrado para id_externo: ${id_externo} o qrData no proporcionado`
        );
      }

      // Actualizar en DB
      await whatsapp_registros.updateOne(
        { id_externo: id_externo },
        { $set: { qr: qrData, estado: "qr" } }
      );
      break;

    case "connected":
      const user = await getUserRecordByIdExterno(id_externo);

      if (user && userSocket) {
        const { id_externo, nombre } = user;

        userSocket.emit("qrstatus", "/assets/check.svg");
        userSocket.emit("log", "Usuario conectado");

        const userinfo = `${id_externo} ${nombre}`;
        userSocket.emit("user", userinfo);
      }
      break;

    case "loading":
      if (userSocket) {
        userSocket.emit("qrstatus", "/assets/loader.gif");
        userSocket.emit("log", "Cargando...");
      }

      await whatsapp_registros.updateOne(
        { id_externo: id_externo },
        { $set: { estado: "cargando" } }
      );
      break;

    case "authenticated":
      if (userSocket) {
        userSocket.emit("qrstatus", "/assets/loader.gif");
        userSocket.emit("log", "Autenticando...");
      }
      break;

    default:
      break;
  }
};

async function updateConnectionStatus(
  id_externo,
  connection,
  lastDisconnect,
  qr
) {
  try {
    const userRecord = await getUserRecordByIdExterno(id_externo);

    if (!userRecord) {
      console.warn(`Usuario ${id_externo} no encontrado en DB`);
      return;
    }

    const previousQR = userRecord.sock?.qr;

    await updateUserRecord(id_externo, {
      sock: {
        connection: connection || null,
        lastDisconnect: lastDisconnect || null,
        qr: qr || previousQR || null,
      },
      updatedAt: new Date(),
    });
  } catch (error) {
    console.error(`Error actualizando estado para ${id_externo}:`, error);
  }
}

/* Metodos para realizar acciones en mongo */
async function updateUserRecord(id_externo, updatedFields) {
  return await whatsapp_registros.updateOne(
    { id_externo: id_externo },
    { $set: updatedFields }
  );
}

async function getUserRecordByIdExterno(id_externo) {
  return await whatsapp_registros.findOne({ id_externo });
}

async function getUserRecords() {
  return await whatsapp_registros.find().toArray();
}

/* Inicializar servidor */
const startServer = async () => {
  try {
    db = await connectToMongoDB();
    await connectMongoose();
    whatsapp_registros = db.collection("registros_whatsapp");

    const registros = await getUserRecords();

    if (!registros || registros.length === 0) {
      console.log("No hay registros aun.");
    } else {
      for (const registro of registros) {
        const id_externo = registro.id_externo;
        const receiveMessages = registro.receive_messages;

        await connectToWhatsApp(id_externo, receiveMessages).catch((err) => {
          console.log(`Error inesperado para id_externo ${id_externo}: ${err}`);
        });
      }
    }

    server.listen(port, () => {
      console.log("Server Run Port : " + port);
    });
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
  }
};

startServer();
