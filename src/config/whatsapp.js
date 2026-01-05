const path = require('path');

const whatsappConfig = {
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-extensions",
            "--disable-infobars",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-sync",
            "--disable-translate",
            "--single-process",
            "--no-zygote",
            "--disable-accelerated-2d-canvas",
            "--memory-pressure-off",
            "--max-old-space-size=512",
            "--window-size=800,600",
            "--disable-default-apps",
            "--disable-domain-reliability",
            "--disable-background-networking",
            "--disable-breakpad",
            "--mute-audio",
            "--no-first-run",
            "--no-default-browser-check",
            // opcionales
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-site-isolation-trials",
            "--disable-blink-features=AutomationControlled",
            "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ],
        defaultViewport: {
            width: 800,
            height: 600,
            deviceScaleFactor: 1,
        },
        timeout: 9000,
    },
    authTimeoutMs: 0,
    qrMaxRetries: 5,
    restartDelay: 5000,
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