const path = require('path');

const whatsappConfig = {
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-infobars',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--mute-audio',
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=800,600',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--disable-session-crashed-bubble',
        ],
        defaultViewport: {
            width: 800,
            height: 600,
            deviceScaleFactor: 1,
        },
        // timeout: 9000,
    },
    // webVersionCache: {
    //     type: 'remote',
    //     remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    // },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014580221-alpha.html',
    },
    authTimeoutMs: 0,
    qrMaxRetries: 5,
    restartDelay: 5000
};

/**
 * Obtener configuración de WhatsApp para un cliente específico
 * @param {string} id_externo - ID del usuario
 * @returns {object} Configuración del cliente
 */
const getWhatsAppConfig = (id_externo) => {
    return {
        authStrategy: new (require('whatsapp-web.js').LocalAuth)({
            clientId: id_externo,
            dataPath: path.join(__dirname, '../../', '.wwebjs_auth', 'sessions'),
        }),
        puppeteer: whatsappConfig.puppeteer,
        authTimeoutMs: whatsappConfig.authTimeoutMs,
        qrMaxRetries: whatsappConfig.qrMaxRetries,
        restartDelay: whatsappConfig.restartDelay,
    };
};

const ACK_STATUS = {
    0: 'Error',
    1: 'Enviado',
    2: 'Recibido por servidor',
    3: 'Recibido por destinatario',
    4: 'Leído',
    5: 'Reproducido'
};

const DEFAULT_COUNTRY_CODE = '593';

const IGNORED_MESSAGE_TYPES = [
    'e2e_notification',
    'notification_template',
    'gp2',
    'broadcast_notification',
    'call_log'
];

const NO_RECONNECT_REASONS = [
    'LOGOUT',
    'UNPAIRED',
    'UNLAUNCHED',
    'CONFLICT',
    'DEPRECATED_VERSION'
];

module.exports = {
    whatsappConfig,
    getWhatsAppConfig,
    ACK_STATUS,
    DEFAULT_COUNTRY_CODE,
    IGNORED_MESSAGE_TYPES,
    NO_RECONNECT_REASONS
};