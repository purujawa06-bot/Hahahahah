const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { logError } = require('./logger');
const { getKeyValue, setKeyValue, setBatchKeyValue } = require('./database');

const KEY_MAP = {
    'pre-key': 'preKeys',
    'session': 'sessions',
    'sender-key': 'senderKeys',
    'app-state-sync-key': 'appStateSyncKeys',
    'app-state-sync-version': 'appStateVersions',
    'sender-key-memory': 'senderKeyMemory'
};

/**
 * Reads data from Firebase (Async wrapper).
 */
const readData = async (key) => {
    try {
        const data = await getKeyValue(key);
        if (!data) return null;
        return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
    } catch (error) {
        logError(`Failed to read or parse auth data for key ${key}: ${error.message}`);
        return null;
    }
};

/**
 * Writes data to Firebase (Async wrapper).
 */
const writeData = async (key, data) => {
    try {
        const storableData = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await setKeyValue(key, storableData);
    } catch (error) {
        logError(`Failed to prepare or write auth data for key ${key}: ${error.message}`);
    }
};

/**
 * AuthState implementation using Firebase Firestore with Batch Optimization.
 */
const useBatchAuthState = async (_folder) => {
    const credsKey = 'creds';
    
    let creds = await readData(credsKey);
    if (!creds) {
        creds = initAuthCreds();
    }

    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {};
                await Promise.all(ids.map(async (id) => {
                    const key = `${type}-${id}`;
                    let value = await readData(key);
                    if (value) {
                        if (type === 'app-state-sync-key') {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                }));
                return data;
            },
            set: async (data) => {
                // OPTIMIZATION: Collect all writes into a single object for Batch Write
                const batchData = {};
                
                for (const type in data) {
                    if (KEY_MAP[type]) {
                        for (const id in data[type]) {
                            const value = data[type][id];
                            const key = `${type}-${id}`;
                            // Prepare data for JSON serialization
                            batchData[key] = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
                        }
                    }
                }

                // Execute single batch write instead of multiple individual writes
                if (Object.keys(batchData).length > 0) {
                    await setBatchKeyValue(batchData);
                }
            }
        }
    };

    return {
        state,
        saveCreds: async () => {
            await writeData(credsKey, state.creds);
        }
    };
};

module.exports = { useBatchAuthState };