const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const readline = require("readline");

// Modular imports
const config = require('./config');
const { logInfo, logSuccess, logWarning, logError } = require('./lib/logger');
const { initializeDatabase } = require('./lib/database');
const { startDevServer } = require('./lib/devServer');
const { useBatchAuthState } = require('./lib/authState');
const { handleMessage } = require('./lib/messageHandler');
const { initializeBot } = require('./lib/botManager');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function connectToWhatsApp() {
    try {
        // Initialize Firebase (via database module)
        await initializeDatabase();

        // Initialize development server for fast updates
        startDevServer();

        // Initialize authentication state with Firebase
        const { state, saveCreds } = await useBatchAuthState();
        
        // Fetch latest WhatsApp version
        const { version, isLatest } = await fetchLatestBaileysVersion();
        logInfo(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        // Create WhatsApp socket connection
        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: Browsers.macOS('Chrome')
        });

        // Handle pairing if not registered
        if (!sock.authState.creds.registered) {
            await initializeBot(sock, rl, question);
        }

        // Set up event listeners
        setupEventListeners(sock, saveCreds);

    } catch (error) {
        logError(`Failed to initialize WhatsApp connection: ${error.stack}`);
        process.exit(1);
    }
}

function setupEventListeners(sock, saveCreds) {
    // Credentials update handler (waits for async write)
    sock.ev.on('creds.update', saveCreds);

    // Connection state handler
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
                logWarning("Cannot reconnect. Please check Firestore or re-pair the bot.");
            }
        } else if (connection === 'open') {
            logSuccess('Connection opened successfully!');
        }
    });

    // Message handler
    sock.ev.on('messages.upsert', (m) => {
        handleMessage(sock, m);
    });
}

// Start the bot
connectToWhatsApp().catch(err => logError(`Failed to connect to WhatsApp: ${err.stack}`));