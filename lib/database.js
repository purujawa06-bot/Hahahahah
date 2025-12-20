const { db } = require('./firebase');
const { logInfo, logError } = require('./logger');

// Collections
const KV_COLLECTION = 'wa_kv_store';
const DISABLED_CMD_COLLECTION = 'wa_disabled_commands';
const CHAT_HISTORY_COLLECTION = 'wa_chat_history';

/**
 * Initializes the database (Compatibility wrapper)
 */
async function initializeDatabase() {
    // Firestore tidak butuh init tabel manual seperti SQLite
    logInfo('Database adapter switched to Firebase Firestore.');
}

// --- Generic Key-Value Functions ---

async function getKeyValue(key) {
    try {
        const doc = await db.collection(KV_COLLECTION).doc(key).get();
        if (!doc.exists) return null;
        // Kita simpan sebagai object di field 'data' untuk menghindari isu tipe data root document
        return doc.data().value;
    } catch (error) {
        logError(`Failed to get key '${key}': ${error.message}`);
        return null;
    }
}

async function setKeyValue(key, value) {
    try {
        // Simpan value langsung (object/string/number)
        // Jika value mengandung undefined, Firestore akan menolak kecuali ignoreUndefinedProperties diset true
        await db.collection(KV_COLLECTION).doc(key).set({ value: value });
        return true;
    } catch (error) {
        logError(`Failed to set key '${key}': ${error.message}`);
        return false;
    }
}

// --- Disabled Command Functions ---

async function getDisabledCommands() {
    try {
        const snapshot = await db.collection(DISABLED_CMD_COLLECTION).get();
        const commands = new Set();
        snapshot.forEach(doc => {
            commands.add(doc.id);
        });
        return commands;
    } catch (error) {
        logError(`Failed to get disabled commands: ${error.message}`);
        return new Set();
    }
}

async function addDisabledCommand(commandName) {
    try {
        await db.collection(DISABLED_CMD_COLLECTION).doc(commandName).set({
            disabledAt: Date.now()
        });
        return true;
    } catch (error) {
        logError(`Failed to add disabled command '${commandName}': ${error.message}`);
        return false;
    }
}

async function removeDisabledCommand(commandName) {
    try {
        await db.collection(DISABLED_CMD_COLLECTION).doc(commandName).delete();
        return true;
    } catch (error) {
        logError(`Failed to remove disabled command '${commandName}': ${error.message}`);
        return false;
    }
}

// --- Chat History Functions (For AI) ---

/**
 * Adds a message to the chat history in Firestore.
 */
async function addChatHistory(jid, role, message) {
    try {
        // Gunakan subcollection per JID untuk query yang lebih efisien dan murah
        // Collection: wa_chat_history -> Doc: {JID} -> SubCollection: messages
        await db.collection(CHAT_HISTORY_COLLECTION)
            .doc(jid)
            .collection('messages')
            .add({
                role,
                message,
                timestamp: Date.now()
            });
        
        // Note: Cleanup data lama di Firestore biasanya dilakukan via Cloud Functions (Scheduled)
        // untuk menghemat operasi Read/Write/Delete di sisi bot.
        return true;
    } catch (error) {
        logError(`Failed to add chat history: ${error.message}`);
        return false;
    }
}

/**
 * Retrieves the last N messages for context from Firestore.
 */
async function getChatHistory(jid, limit = 10) {
    try {
        const snapshot = await db.collection(CHAT_HISTORY_COLLECTION)
            .doc(jid)
            .collection('messages')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        const messages = [];
        snapshot.forEach(doc => {
            messages.push(doc.data());
        });

        // Reverse agar urutannya kronologis (Oldest -> Newest) untuk konteks AI
        return messages.reverse();
    } catch (error) {
        logError(`Failed to get chat history: ${error.message}`);
        return [];
    }
}

module.exports = {
    initializeDatabase,
    getKeyValue,
    setKeyValue,
    getDisabledCommands,
    addDisabledCommand,
    removeDisabledCommand,
    addChatHistory,
    getChatHistory
};