const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const readline = require("readline");
const fs = require('fs'); 

// Modular imports
const { logInfo, logSuccess, logWarning, logError } = require('./lib/logger');
const { initializeDatabase, performMaintenance } = require('./lib/database');
const { startDevServer } = require('./lib/devServer');
const { useBatchAuthState } = require('./lib/authState');
const { handleMessage } = require('./lib/messageHandler');
const { initializeBot } = require('./lib/botManager');
const { loadPlugins } = require('./lib/pluginManager');

// --- GLOBAL ERROR HANDLERS (ANTI-CRASH) ---
// Menangkap error fatal yang tidak tertangani agar bot tidak mati mendadak
process.on('uncaughtException', (err) => {
    logError(`Caught exception: ${err.message}`);
    // Handle ENOSPC (Disk Full) specifically
    if (err.code === 'ENOSPC' || err.message.includes('no space')) {
        logWarning('WARNING: Disk Full (ENOSPC). System stability compromised. Ignoring to prevent crash.');
    }
});

process.on('unhandledRejection', (reason, promise) => {
    logError(`Unhandled Rejection: ${reason}`);
    if (reason && reason.toString().includes('ENOSPC')) {
        logWarning('WARNING: Disk Full detected in Promise. Ignoring.');
    }
});
// ------------------------------------------

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function connectToWhatsApp() {
    try {
        // Initialize Database
        await initializeDatabase();

        // Load Plugins
        logInfo("Loading plugins...");
        loadPlugins();

        // Initialize development server
        startDevServer();

        // Initialize authentication state
        const { state, saveCreds } = await useBatchAuthState();
        
        const { version, isLatest } = await fetchLatestBaileysVersion();
        logInfo(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            // ANTI-BAN: Use Ubuntu browser signature instead of MacOS (common for bots)
            browser: Browsers.ubuntu('Chrome'),
            // ANTI-BAN: Retry configuration
            retryRequestDelayMs: 2000,
            connectTimeoutMs: 60000,
        });

        // --- DEV FEATURE: Generate sampler.sock.json ---
        try {
            const inspectSock = (obj) => {
                const description = {};
                for (const key in obj) {
                    const type = typeof obj[key];
                    if (type === 'function') {
                        description[key] = 'Function';
                    } else if (type === 'object' && obj[key] !== null) {
                        if (Array.isArray(obj[key])) {
                            description[key] = 'Array';
                        } else {
                            try {
                                description[key] = `Object { ${Object.keys(obj[key]).join(', ')} }`;
                            } catch (e) {
                                description[key] = 'Object (Circular/Complex)';
                            }
                        }
                    } else {
                        description[key] = obj[key];
                    }
                }
                return description;
            };
            
            fs.writeFileSync('sampler.sock.json', JSON.stringify(inspectSock(sock), null, 2));
            logInfo("Debug: sampler.sock.json generated.");
        } catch (error) {
            logWarning(`Failed to generate sampler.sock.json: ${error.message}`);
        }
        // -----------------------------------------------

        if (!sock.authState.creds.registered) {
            await initializeBot(sock, rl, question);
        }

        setupEventListeners(sock, saveCreds);

        // OPTIMIZATION: Scheduled Database Maintenance
        setInterval(async () => {
            logInfo("Starting scheduled database maintenance...");
            await performMaintenance();
        }, 1000 * 60 * 60); // 1 Hour

    } catch (error) {
        logError(`Failed to initialize WhatsApp connection: ${error.stack}`);
        // Do not exit on init failure, allow retry logic via PM2 if needed, or manual fix
    }
}

function setupEventListeners(sock, saveCreds) {
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) &&
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            
            logError(`Connection closed: ${lastDisconnect.error?.message}`);
            
            if (shouldReconnect) {
                logInfo("Attempting to reconnect...");
                setTimeout(connectToWhatsApp, 5000);
            } else {
                logWarning("Cannot reconnect. Please check Firestore/DB or re-pair the bot.");
            }
        } else if (connection === 'open') {
            logSuccess('Connection opened successfully!');
        }
    });

    sock.ev.on('messages.upsert', (m) => {
        handleMessage(sock, m);
    });
}

connectToWhatsApp().catch(err => logError(`Failed to connect to WhatsApp: ${err.stack}`));