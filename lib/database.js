const Database = require('better-sqlite3');
const path = require('path');
const { logInfo, logError } = require('./logger');

// Database initialization
const dbPath = path.join(__dirname, '..', 'database.sqlite');
let db;

/**
 * Initializes the SQLite database with WAL mode.
 */
async function initializeDatabase() {
    try {
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        
        // Key-Value Store Table (for Auth State & Config)
        db.exec(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);

        // Disabled Commands Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS disabled_commands (
                command TEXT PRIMARY KEY,
                disabledAt INTEGER
            )
        `);

        // Chat History Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                jid TEXT,
                role TEXT,
                message TEXT,
                timestamp INTEGER
            )
        `);
        
        // Indexes for performance
        db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_history_jid ON chat_history(jid)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp ON chat_history(timestamp)`);

        logInfo('Database adapter switched to SQLite (WAL Mode enabled).');
    } catch (error) {
        logError(`Failed to initialize SQLite database: ${error.message}`);
        process.exit(1);
    }
}

// --- Generic Key-Value Functions ---

async function getKeyValue(key) {
    try {
        const stmt = db.prepare('SELECT value FROM kv_store WHERE key = ?');
        const row = stmt.get(key);
        if (!row) return null;
        return JSON.parse(row.value);
    } catch (error) {
        logError(`Failed to get key '${key}': ${error.message}`);
        return null;
    }
}

async function setKeyValue(key, value) {
    try {
        const stmt = db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)');
        stmt.run(key, JSON.stringify(value));
        return true;
    } catch (error) {
        logError(`Failed to set key '${key}': ${error.message}`);
        return false;
    }
}

/**
 * Batch set keys using a transaction for atomic writes and speed.
 */
async function setBatchKeyValue(dataObject) {
    try {
        const insert = db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)');
        const insertMany = db.transaction((data) => {
            for (const [key, value] of Object.entries(data)) {
                insert.run(key, JSON.stringify(value));
            }
        });
        
        insertMany(dataObject);
        return true;
    } catch (error) {
        logError(`Failed to batch set keys: ${error.message}`);
        return false;
    }
}

// --- Disabled Command Functions ---

async function getDisabledCommands() {
    try {
        const stmt = db.prepare('SELECT command FROM disabled_commands');
        const rows = stmt.all();
        const commands = new Set();
        rows.forEach(row => commands.add(row.command));
        return commands;
    } catch (error) {
        logError(`Failed to get disabled commands: ${error.message}`);
        return new Set();
    }
}

async function addDisabledCommand(commandName) {
    try {
        const stmt = db.prepare('INSERT OR REPLACE INTO disabled_commands (command, disabledAt) VALUES (?, ?)');
        stmt.run(commandName, Date.now());
        return true;
    } catch (error) {
        logError(`Failed to add disabled command '${commandName}': ${error.message}`);
        return false;
    }
}

async function removeDisabledCommand(commandName) {
    try {
        const stmt = db.prepare('DELETE FROM disabled_commands WHERE command = ?');
        stmt.run(commandName);
        return true;
    } catch (error) {
        logError(`Failed to remove disabled command '${commandName}': ${error.message}`);
        return false;
    }
}

// --- Chat History Functions ---

/**
 * Adds a message to the chat history table.
 * Includes auto-pruning to keep database size manageable.
 */
async function addChatHistory(jid, role, message) {
    try {
        const timestamp = Date.now();
        const insert = db.prepare('INSERT INTO chat_history (jid, role, message, timestamp) VALUES (?, ?, ?, ?)');
        
        // Transaction to Insert and optionally Prune
        const processHistory = db.transaction(() => {
            insert.run(jid, role, message, timestamp);
            
            // Check count
            const countStmt = db.prepare('SELECT count(*) as count FROM chat_history WHERE jid = ?');
            const result = countStmt.get(jid);
            
            if (result.count > 50) {
                // Keep only the latest 40 messages (Prune old ones)
                const deleteStmt = db.prepare(`
                    DELETE FROM chat_history 
                    WHERE id IN (
                        SELECT id FROM chat_history 
                        WHERE jid = ? 
                        ORDER BY timestamp DESC 
                        LIMIT -1 OFFSET 40
                    )
                `);
                deleteStmt.run(jid);
            }
        });
        
        processHistory();
        return true;
    } catch (error) {
        logError(`Failed to add chat history: ${error.message}`);
        return false;
    }
}

/**
 * Retrieves chat history from SQLite.
 */
async function getChatHistory(jid, limit = 10) {
    try {
        // Get latest N messages
        const stmt = db.prepare('SELECT role, message, timestamp FROM chat_history WHERE jid = ? ORDER BY timestamp DESC LIMIT ?');
        const rows = stmt.all(jid, limit);
        
        // Reverse to return in chronological order (Oldest -> Newest) as expected by AI context
        return rows.reverse();
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