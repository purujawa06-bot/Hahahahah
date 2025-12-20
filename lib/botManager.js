const { logSuccess, logError } = require('./logger');

/**
 * Initializes the bot with pairing if not registered
 * @param {object} sock - WhatsApp socket instance
 * @param {object} rl - Readline interface
 * @param {function} question - Question prompt function
 */
async function initializeBot(sock, rl, question) {
    try {
        const phoneNumber = await question('Enter your phone number (e.g., 6281234567890): ');
        const code = await sock.requestPairingCode(phoneNumber);
        logSuccess(`Your Pairing Code: ${code}`);
        
        // Close readline after getting pairing code
        rl.close();
    } catch (error) {
        logError("Failed to request pairing code. Make sure the phone number is correct and try again.");
        rl.close();
        process.exit(1);
    }
}

module.exports = { initializeBot };