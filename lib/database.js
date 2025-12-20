const { db, admin } = require('./firebase');
const { logInfo, logError } = require('./logger');

// Collections
const KV_COLLECTION = 'wa_kv_store';
const DISABLED_CMD_COLLECTION = 'wa_disabled_commands';
const CHAT_HISTORY_COLLECTION = 'wa_chat_history';

/**
 * Initializes the database (Compatibility wrapper)
 */
async function initializeDatabase() {
    logInfo('Database adapter switched to Firebase Firestore (Cost Optimized).');
}

// --- Generic Key-Value Functions ---

async function getKeyValue(key) {
    try {
        const doc = await db.collection(KV_COLLECTION).doc(key).get();
        if (!doc.exists) return null;
        return doc.data().value;
    } catch (error) {
        logError(`Failed to get key '${key}': ${error.message}`);
        return null;
    }
}

async function setKeyValue(key, value) {
    try {
        await db.collection(KV_COLLECTION).doc(key).set({ value: value });
        return true;
    } catch (error) {
        logError(`Failed to set key '${key}': ${error.message}`);
        return false;
    }
}

/**
 * Optimized: Set multiple keys in a single Batch operation.
 * Reduces network round-trips significantly.
 */
async function setBatchKeyValue(dataObject) {
    try {
        const batch = db.batch();
        let opCount = 0;

        for (const [key, value] of Object.entries(dataObject)) {
            const ref = db.collection(KV_COLLECTION).doc(key);
            batch.set(ref, { value: value });
            opCount++;
            
            // Firestore batch limit is 500
            if (opCount >= 490) {
                await batch.commit();
                const newBatch = db.batch();
                opCount = 0;
            }
        }
        
        if (opCount > 0) await batch.commit();
        return true;
    } catch (error) {
        logError(`Failed to batch set keys: ${error.message}`);
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

// --- Chat History Functions (Cost Optimized) ---

/**
 * Adds a message to the chat history using ArrayUnion (1 Write Ops).
 * Storing messages in a single document per JID saves massive Read costs later.
 */
async function addChatHistory(jid, role, message) {
    try {
        const docRef = db.collection(CHAT_HISTORY_COLLECTION).doc(jid);
        
        // Gunakan arrayUnion untuk menambahkan data ke array 'msgs'
        await docRef.set({
            lastUpdate: Date.now(),
            msgs: admin.firestore.FieldValue.arrayUnion({
                role,
                message,
                timestamp: Date.now()
            })
        }, { merge: true });
        
        return true;
    } catch (error) {
        logError(`Failed to add chat history: ${error.message}`);
        return false;
    }
}

/**
 * Retrieves chat history from a single document (1 Read Ops).
 * Handles array slicing and auto-cleanup in memory.
 */
async function getChatHistory(jid, limit = 10) {
    try {
        const docRef = db.collection(CHAT_HISTORY_COLLECTION).doc(jid);
        const doc = await docRef.get();

        if (!doc.exists) return [];

        const data = doc.data();
        let messages = data.msgs || [];

        // COST SAVING: Auto-prune jika history terlalu panjang untuk menghemat storage
        // Dilakukan hanya jika panjang array > 40
        if (messages.length > 40) {
            // Ambil 20 terakhir saja
            const keptMessages = messages.slice(-20);
            // Update DB secara background (fire and forget) untuk menghemat waktu respon bot
            docRef.update({ msgs: keptMessages }).catch(e => console.error("Prune error:", e.message));
            messages = keptMessages;
        }

        // Return N pesan terakhir
        // Karena arrayUnion urut berdasarkan waktu masuk (Old -> New), kita ambil dari belakang
        return messages.slice(-limit);
    } catch (error) {
        logError(`Failed to get chat history: ${error.message}`);
        return [];
    }
}

module.exports = {
    initializeDatabase,
    getKeyValue,
    setKeyValue,
    setBatchKeyValue,
    getDisabledCommands,
    addDisabledCommand,
    removeDisabledCommand,
    addChatHistory,
    getChatHistory
};