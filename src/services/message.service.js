const moment = require('moment-timezone');
const https = require('https');
const { MessageMedia } = require('whatsapp-web.js');
const whatsappService = require('./whatsapp.service');
const { ACK_STATUS, DEFAULT_COUNTRY_CODE, IGNORED_MESSAGE_TYPES } = require('../config/whatsapp');

/**
 * Enviar mensaje (texto o con archivo)
 */
exports.sendMessage = async (id_externo, messageData) => {
    const {
        number,
        message,
        tempMessage,
        pdfBase64,
        imageBase64,
        fileName,
        caption
    } = messageData;

    const client = whatsappService.getClient(id_externo);

    if (!client) {
        throw new Error('No existe una sesión activa');
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
        throw new Error(`Cliente no conectado. Estado: ${state}`);
    }

    // Formatear número
    const formattedNumber = formatPhoneNumber(number);

    // ✅ CAMBIO CLAVE: Usar getNumberId en lugar de isRegisteredUser + chatId manual
    let chatId;
    try {
        const numberId = await client.getNumberId(formattedNumber);

        if (!numberId) {
            throw new Error('El número no está registrado en WhatsApp');
        }

        chatId = numberId._serialized;
        console.log('✅ ChatId verificado:', chatId);

    } catch (error) {
        console.error('❌ Error verificando número:', error.message);
        throw new Error(`El número ${formattedNumber} no está registrado en WhatsApp`);
    }

    const messageText = message || tempMessage;
    let result;

    try {
        // Enviar con archivo o solo texto
        if (pdfBase64 || imageBase64) {
            const mimeType = pdfBase64 ? 'application/pdf' : 'image/jpeg';
            const base64Data = pdfBase64 || imageBase64;
            const defaultName = pdfBase64 ? 'documento.pdf' : 'imagen.jpg';

            console.log('📎 Enviando mensaje con multimedia');
            const media = new MessageMedia(mimeType, base64Data, fileName || defaultName);
            result = await client.sendMessage(chatId, media, {
                caption: caption || messageText || ''
            });
        } else {
            console.log('💬 Enviando mensaje de texto simple');
            result = await client.sendMessage(chatId, messageText);
        }
    } catch (sendError) {
        console.error('❌ Error al enviar mensaje:', sendError);

        // Manejo de errores específicos
        if (sendError.message.includes('Evaluation failed')) {
            throw new Error('Error al procesar el mensaje. El número puede no ser válido');
        }

        if (sendError.message.includes('Phone not connected')) {
            throw new Error('Teléfono desconectado. Reconecta el dispositivo');
        }

        throw new Error(`Error enviando mensaje: ${sendError.message}`);
    }

    // Información de respuesta
    const info = client.info;
    const fecha = moment().tz('America/Guayaquil').format('YYYY-MM-DD HH:mm:ss');

    console.log(`✅ Mensaje enviado de ${id_externo} a ${formattedNumber}`);

    return {
        messageId: result.id._serialized,
        timestamp: result.timestamp,
        senderNumber: info.wid.user,
        recipientNumber: formattedNumber,
        ack: result.ack,
        ackName: ACK_STATUS[result.ack] || 'Desconocido',
        fecha
    };
};

/**
 * Enviar mensaje multimedia
 */
exports.sendMediaMessage = async (id_externo, mediaData) => {
    const { number, tempMessage, link, type, latitud, longitud, file } = mediaData;

    const client = whatsappService.getClient(id_externo);

    if (!client) {
        throw new Error('No existe una sesión activa');
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
        throw new Error(`Cliente no conectado. Estado: ${state}`);
    }

    const formattedNumber = formatPhoneNumber(number);
    const chatId = formattedNumber + '@c.us';

    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
        throw new Error('El número no está registrado en WhatsApp');
    }

    let result;

    switch (type) {
        case 'image':
            const imageMedia = await MessageMedia.fromUrl(link);
            result = await client.sendMessage(chatId, imageMedia, {
                caption: tempMessage || ''
            });
            console.log(`🖼️ Imagen enviada a ${formattedNumber}`);
            break;

        case 'video':
            const videoMedia = await MessageMedia.fromUrl(link);
            result = await client.sendMessage(chatId, videoMedia, {
                caption: tempMessage || '',
                sendMediaAsDocument: false
            });
            console.log(`🎥 Video enviado a ${formattedNumber}`);
            break;

        case 'audio':
            const audioMedia = await MessageMedia.fromUrl(link);
            result = await client.sendMessage(chatId, audioMedia, {
                sendAudioAsVoice: true
            });
            console.log(`🎵 Audio enviado a ${formattedNumber}`);
            break;

        case 'location':
            const location = new Location(latitud, longitud, tempMessage || '');
            result = await client.sendMessage(chatId, location);
            console.log(`📍 Ubicación enviada a ${formattedNumber}`);
            break;

        case 'document':
            const pathname = new URL(link).pathname;
            const filename = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
            const docMedia = await MessageMedia.fromUrl(link);
            docMedia.filename = filename;
            result = await client.sendMessage(chatId, docMedia, {
                caption: tempMessage || '',
                sendMediaAsDocument: true
            });
            console.log(`📄 Documento enviado a ${formattedNumber}`);
            break;

        case 'documentBase64':
            const pdfMedia = new MessageMedia(
                'application/pdf',
                link, // Base64 string
                `${file || 'documento'}.pdf`
            );
            result = await client.sendMessage(chatId, pdfMedia, {
                caption: tempMessage || '',
                sendMediaAsDocument: true
            });
            console.log(`📎 PDF Base64 enviado a ${formattedNumber}`);
            break;

        default:
            result = await client.sendMessage(chatId, tempMessage);
            console.log(`💬 Mensaje de texto enviado a ${formattedNumber}`);
            break;
    }

    const info = client.info;
    const fecha = moment().tz('America/Guayaquil').format('YYYY-MM-DD HH:mm:ss');

    // Log del mensaje enviado
    console.log({
        De: `cliente-${id_externo}`,
        Para: formattedNumber,
        EnviadoPor: info.wid.user,
        Message: tempMessage,
        Tipo: type,
        Fecha: fecha,
        MessageId: result.id._serialized,
    });

    // Esperar un momento para que se procese el envío
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
        messageId: result.id._serialized,
        timestamp: result.timestamp,
        senderNumber: info.wid.user,
        recipientNumber: formattedNumber,
        type,
        ack: result.ack,
        ackName: ACK_STATUS[result.ack],
        fecha
    };
};

/**
 * Manejar mensaje entrante
 */
exports.handleIncomingMessage = async (message, id_externo, client) => {
    try {

        if (!message || !message.from) {
            console.warn('⚠️ Mensaje inválido recibido');
            return;
        }

        if (message.fromMe) {
            return;
        }

        const messageType = message.type || 'unknown';
        if (IGNORED_MESSAGE_TYPES && IGNORED_MESSAGE_TYPES.includes(messageType)) {
            console.log(`⏭️ Ignorando mensaje tipo: ${messageType}`);
            return;
        }

        const chat = await message.getChat();
        const isGroup = chat.isGroup;

        // Solo procesar mensajes directos
        if (isGroup) {
            console.log('⏭️ Ignorando mensaje de grupo');
            return;
        }
        const from = message.from || '';
        let senderNumber = from;
        let contactName = '';

        if (senderNumber.includes('@lid')) {
            // ⭐ getContactLidAndPhone devuelve un array, necesitas extraer el número
            const contactInfoArray = await client.getContactLidAndPhone([senderNumber]);

            if (contactInfoArray && contactInfoArray.length > 0) {
                const data = contactInfoArray[0];
                senderNumber = data.pn;
                console.log(`✅ Número real obtenido: ${senderNumber}`);
            } else {
                console.warn(`⚠️ No se pudo obtener el número real para ${senderNumber}`);
            }
        }

        // Intentar obtener el número del contacto para validación
        try {
            const contact = await message.getContact();

            contactName = contact.pushname || // Nombre que el usuario puso en WhatsApp
                contact.name ||     // Nombre guardado en tu lista de contactos
                contact.verifiedName || // Nombre verificado (empresas)
                contact.number ||   // Si no hay nombre, usar número
                senderNumber.split('@')[0]; // Fallback al ID

        } catch (err) {
            console.warn('⚠️ No se pudo obtener contacto, usando número del mensaje');
        }

        const reciberNumber = client.info?.wid?.user || 'desconocido';

        let captureMessage = '';
        let base64Media = null;
        let mediaMimeType = null;
        let mediaFileName = null;
        let hasMediaContent = false;

        if (message.hasMedia) {
            try {
                const media = await message.downloadMedia();
                if (media && media.data) {
                    base64Media = media.data;
                    mediaMimeType = media.mimetype || 'application/octet-stream';
                    const ext = mediaMimeType.split('/')[1]?.split(';')[0] || 'bin';
                    mediaFileName = media.filename || `${messageType}_${Date.now()}.${ext}`;
                    hasMediaContent = true;
                }
            } catch (err) {
                console.error('❌ Error descargando media:', err.message);
            }
        }

        // Capturar texto según tipo
        switch (messageType) {
            case 'chat':
                captureMessage = message.body || '';
                break;
            case 'image':
            case 'video':
            case 'document':
            case 'audio':
            case 'ptt':
                captureMessage = message.caption || message.body || '';
                break;
            case 'location':
                captureMessage = `[Ubicación: ${message.location?.latitude}, ${message.location?.longitude}]`;
                break;
            case 'vcard':
                captureMessage = '[Contacto compartido]';
                break;
            case 'sticker':
                captureMessage = '[Sticker]';
                break;
            default:
                captureMessage = message.body || `[${messageType}]`;
        }

        console.log(`📩 Mensaje de ${senderNumber} (tipo: ${messageType}): ${captureMessage.substring(0, 50)}${captureMessage.length > 50 ? '...' : ''}`);

        await sendToWebhook({
            id: message.id.id,
            empresa: 'sigcrm_clinicasancho',
            name: contactName,
            senderNumber: senderNumber,
            reciberNumber,
            description: captureMessage,
            messageType: messageType,
            mediaDataBase64: base64Media,
            mediaMimeType,
            mediaFileName,
            hasMediaContent,
            timestamp: message.timestamp || Date.now()
        });

    } catch (error) {
        console.error('❌ Error procesando mensaje:', error.message);
        console.error('Stack:', error.stack);
    }
};

exports.sendLidMessage = async (id_externo, messageData) => {
    const {
        chatId,
        message,
        tempMessage,
        pdfBase64,
        imageBase64,
        audioBase64,
        videoBase64,
        documentBase64,
        fileName,
        caption
    } = messageData;

    const client = whatsappService.getClient(id_externo);

    if (!client) {
        throw new Error('No existe una sesión activa');
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
        throw new Error(`Cliente no conectado. Estado: ${state}`);
    }

    // Validar formato del chatId
    if (!chatId.includes('@lid')) {
        throw new Error('El chatId proporcionado no es un identificador @lid válido');
    }

    console.log('📤 Enviando mensaje a contacto @lid:', chatId);

    // Verificar que el chat existe
    let chatExists = false;
    try {
        const chat = await client.getChatById(chatId);
        chatExists = !!chat;
        console.log('✅ Chat @lid encontrado:', chat.name || 'Sin nombre');
    } catch (error) {
        console.warn('⚠️ No se pudo verificar chat, intentando enviar de todas formas...');
        // Continuar de todas formas, WhatsApp puede crear el chat
    }

    const messageText = message || tempMessage;
    let result;

    try {
        // Determinar tipo de archivo
        let media = null;
        let mimeType = null;
        let base64Data = null;
        let defaultName = null;

        if (pdfBase64) {
            mimeType = 'application/pdf';
            base64Data = pdfBase64;
            defaultName = 'documento.pdf';
        } else if (imageBase64) {
            mimeType = 'image/jpeg';
            base64Data = imageBase64;
            defaultName = 'imagen.jpg';
        } else if (audioBase64) {
            mimeType = 'audio/ogg; codecs=opus';
            base64Data = audioBase64;
            defaultName = 'audio.ogg';
        } else if (videoBase64) {
            mimeType = 'video/mp4';
            base64Data = videoBase64;
            defaultName = 'video.mp4';
        } else if (documentBase64) {
            mimeType = 'application/octet-stream';
            base64Data = documentBase64;
            defaultName = 'documento.bin';
        }

        // Enviar mensaje
        if (base64Data) {
            console.log('📎 Enviando mensaje con archivo a @lid');
            media = new MessageMedia(mimeType, base64Data, fileName || defaultName);
            result = await client.sendMessage(chatId, media, {
                caption: caption || messageText || ''
            });
        } else if (messageText) {
            console.log('💬 Enviando mensaje de texto a @lid');
            result = await client.sendMessage(chatId, messageText);
        } else {
            throw new Error('No hay contenido para enviar');
        }

    } catch (sendError) {
        console.error('❌ Error al enviar mensaje a @lid:', sendError);

        // Manejo de errores específicos
        if (sendError.message.includes('chat not found')) {
            throw new Error('Chat @lid no encontrado. El contacto debe escribirte primero.');
        }

        if (sendError.message.includes('Evaluation failed')) {
            throw new Error('Error al procesar el mensaje para @lid');
        }

        if (sendError.message.includes('Phone not connected')) {
            throw new Error('Teléfono desconectado. Reconecta el dispositivo');
        }

        throw new Error(`Error enviando mensaje a @lid: ${sendError.message}`);
    }

    // Información de respuesta
    const info = client.info;
    const fecha = moment().tz('America/Guayaquil').format('YYYY-MM-DD HH:mm:ss');

    console.log(`✅ Mensaje enviado de ${id_externo} a chatId @lid: ${chatId}`);

    return {
        messageId: result.id._serialized,
        timestamp: result.timestamp,
        senderNumber: info.wid.user,
        recipientChatId: chatId,
        recipientType: 'lid',
        ack: result.ack,
        ackName: ACK_STATUS[result.ack] || 'Desconocido',
        fecha,
        chatExists
    };
};

exports.sendMediaMessageUniversal = async (id_externo, mediaData) => {
    const { number, tempMessage, link, type, latitud, longitud, file } = mediaData;

    // Determinar el tipo de contacto
    let chatId;
    let contactType;

    if (number.includes('@lid')) {
        // Contacto @lid
        chatId = number;
        contactType = 'lid';
    } else if (number.includes('@c.us')) {
        // Contacto @c.us
        chatId = number;
        contactType = 'c.us';
    } else if (number.includes('@')) {
        chatId = number;
        contactType = number.includes('@lid') ? 'lid' : 'c.us';
    } else {
        const formattedNumber = formatPhoneNumber(number);
        chatId = `${formattedNumber}@c.us`;
        contactType = 'c.us';
    }

    const client = whatsappService.getClient(id_externo);
    if (!client) {
        throw new Error('No existe una sesión activa');
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
        throw new Error(`Cliente no conectado. Estado: ${state}`);
    }

    if (contactType === 'c.us') {
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            throw new Error('El número no está registrado en WhatsApp');
        }
    }

    let result;

    switch (type) {
        case 'image':
            const imageMedia = await MessageMedia.fromUrl(link);
            result = await client.sendMessage(chatId, imageMedia, {
                caption: tempMessage || ''
            });
            break;

        case 'video':
            const videoMedia = await MessageMedia.fromUrl(link);
            result = await client.sendMessage(chatId, videoMedia, {
                caption: tempMessage || '',
                sendMediaAsDocument: false
            });
            break;

        case 'audio':
            const audioMedia = await MessageMedia.fromUrl(link);
            result = await client.sendMessage(chatId, audioMedia, {
                sendAudioAsVoice: true
            });
            break;

        case 'location':
            const location = new Location(latitud, longitud, tempMessage || '');
            result = await client.sendMessage(chatId, location);
            break;

        case 'document':
            const pathname = new URL(link).pathname;
            const filename = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
            const docMedia = await MessageMedia.fromUrl(link);
            docMedia.filename = filename;
            result = await client.sendMessage(chatId, docMedia, {
                caption: tempMessage || '',
                sendMediaAsDocument: true
            });
            break;

        case 'documentBase64':
            const pdfMedia = new MessageMedia(
                'application/pdf',
                link,
                `${file || 'documento'}.pdf`
            );
            result = await client.sendMessage(chatId, pdfMedia, {
                caption: tempMessage || '',
                sendMediaAsDocument: true
            });
            break;

        default:
            result = await client.sendMessage(chatId, tempMessage);
            break;
    }

    const info = client.info;
    const fecha = moment().tz('America/Guayaquil').format('YYYY-MM-DD HH:mm:ss');

    console.log({
        De: `cliente-${id_externo}`,
        Para: chatId,
        EnviadoPor: info.wid.user,
        Message: tempMessage,
        Tipo: type,
        TipoContacto: contactType.toUpperCase(),
        Fecha: fecha,
        MessageId: result.id._serialized,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
        messageId: result.id._serialized,
        timestamp: result.timestamp,
        senderNumber: info.wid.user,
        recipientContact: chatId,
        contactType,
        type,
        ack: result.ack,
        ackName: ACK_STATUS[result.ack],
        fecha
    };
};

/**
 * Formatear número de teléfono
 */
function formatPhoneNumber(number) {
    let formatted = String(number || '').replace(/[^\d]/g, '');

    if (!formatted) {
        throw new Error('Número inválido');
    }

    // Agregar código de país Ecuador
    if (formatted.length === 10 && !formatted.startsWith(DEFAULT_COUNTRY_CODE)) {
        formatted = DEFAULT_COUNTRY_CODE + formatted;
    } else if (formatted.length === 9 && !formatted.startsWith(DEFAULT_COUNTRY_CODE)) {
        formatted = DEFAULT_COUNTRY_CODE + formatted;
    }

    return formatted;
}

/**
 * Enviar datos a webhook
 */
async function sendToWebhook(data) {
    return new Promise((resolve, reject) => {

        console.log('🌐 Enviando datos al webhook:');
        console.log(data);
        return;
        const payload = JSON.stringify(data);

        const options = {
            hostname: 'sigcrm.pro',
            path: '/response-baileys',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`✅ Webhook OK: ${res.statusCode}`);
                    resolve(responseData);
                } else {
                    console.warn(`⚠️ Webhook respondió: ${res.statusCode}`);
                    resolve(responseData);
                }
            });
        });

        req.on('error', error => {
            console.error('❌ Error webhook:', error.message);
            reject(error);
        });

        req.on('timeout', () => {
            console.error('❌ Timeout webhook');
            req.destroy();
            reject(new Error('Timeout'));
        });

        req.write(payload);
        req.end();
    });
}