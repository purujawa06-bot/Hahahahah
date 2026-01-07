const mysql = require('mysql2/promise');
const { logInfo, logError, logWarning } = require('./logger');

let pool;

/**
 * Initializes the MySQL Database Connection Pool.
 */
async function initializeDatabase() {
    try {
        pool = mysql.createPool({
            host: 'zeta.optiklink.com',
            port: 3306,
            user: 'u268052_Pue4ZyFtri',
            password: 'p=+PqPac2BUwNa=MKODb!zER',
            database: 's268052_botwa',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0,
            // Ensure emoji support
            charset: 'utf8mb4' 
        });

        // Test connection
        const connection = await pool.getConnection();
        logInfo('Connected to MySQL Server (zeta.optiklink.com).');
        connection.release();

        // Key-Value Store Table
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS kv_store (
                \`key\` VARCHAR(191) PRIMARY KEY,
                value LONGTEXT
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);

        // Disabled Commands Table
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS disabled_commands (
                command VARCHAR(191) PRIMARY KEY,
                disabledAt BIGINT
            )
        `);

        // Chat History Table
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS chat_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                jid VARCHAR(191),
                role VARCHAR(50),
                message TEXT,
                senderName VARCHAR(255),
                timestamp BIGINT,
                INDEX idx_jid (jid),
                INDEX idx_timestamp (timestamp)
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);

        // User Memory Table (Smart Long-term Memory)
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS user_memory (
                id INT AUTO_INCREMENT PRIMARY KEY,
                jid VARCHAR(191),
                memory_text TEXT,
                created_at BIGINT,
                INDEX idx_user_memory_jid (jid)
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);
        
        logInfo('MySQL tables initialized.');
    } catch (error) {
        logError(`Failed to initialize MySQL database: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Perform maintenance (Pruning old chat history).
 */
async function performMaintenance() {
    try {
        // Option 1: Try Modern MySQL Window Function to keep last 50 per JID
        try {
            await pool.execute(`
                DELETE FROM chat_history 
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY jid ORDER BY timestamp DESC) as rn
                        FROM chat_history
                    ) t WHERE t.rn > 50
                )
            `);
            logInfo(`Database maintenance: Pruned chat history (Window Function).`);
        } catch (e) {
            // Option 2: Fallback for older MySQL versions - Delete older than 24 hours
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            const [result] = await pool.execute('DELETE FROM chat_history WHERE timestamp < ?', [oneDayAgo]);
            logWarning(`Database maintenance (Fallback): Pruned ${result.affectedRows} messages older than 24h.`);
        }
    } catch (error) {
        logError(`Database maintenance failed: ${error.message}`);
    }
}

// --- Generic Key-Value Functions ---

async function getKeyValue(key) {
    try {
        const [rows] = await pool.execute('SELECT value FROM kv_store WHERE `key` = ?', [key]);
        if (rows.length === 0) return null;
        return JSON.parse(rows[0].value);
    } catch (error) {
        logError(`Failed to get key '${key}': ${error.message}`);
        return null;
    }
}

async function setKeyValue(key, value) {
    try {
        // REPLACE INTO works like Insert or Update (Delete + Insert)
        await pool.execute('REPLACE INTO kv_store (`key`, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
        return true;
    } catch (error) {
        logError(`Failed to set key '${key}': ${error.message}`);
        return false;
    }
}

async function setBatchKeyValue(dataObject) {
    if (!pool) return false;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const stmt = 'REPLACE INTO kv_store (`key`, value) VALUES (?, ?)';
        
        for (const [key, value] of Object.entries(dataObject)) {
            await connection.execute(stmt, [key, JSON.stringify(value)]);
        }
        
        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        logError(`Failed to batch set keys: ${error.message}`);
        return false;
    } finally {
        connection.release();
    }
}

// --- Disabled Command Functions ---

async function getDisabledCommands() {
    try {
        const [rows] = await pool.execute('SELECT command FROM disabled_commands');
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
        await pool.execute('REPLACE INTO disabled_commands (command, disabledAt) VALUES (?, ?)', [commandName, Date.now()]);
        return true;
    } catch (error) {
        logError(`Failed to add disabled command '${commandName}': ${error.message}`);
        return false;
    }
}

async function removeDisabledCommand(commandName) {
    try {
        await pool.execute('DELETE FROM disabled_commands WHERE command = ?', [commandName]);
        return true;
    } catch (error) {
        logError(`Failed to remove disabled command '${commandName}': ${error.message}`);
        return false;
    }
}

// --- Chat History Functions ---

async function addChatHistory(jid, role, message, senderName = '') {
    try {
        const timestamp = Date.now();
        await pool.execute(
            'INSERT INTO chat_history (jid, role, message, senderName, timestamp) VALUES (?, ?, ?, ?, ?)',
            [jid, role, message, senderName, timestamp]
        );
        return true;
    } catch (error) {
        logError(`Failed to add chat history: ${error.message}`);
        return false;
    }
}

async function getChatHistory(jid, limit = 10) {
    try {
        // MySQL OFFSET/LIMIT
        const [rows] = await pool.execute(
            'SELECT role, message, senderName, timestamp FROM chat_history WHERE jid = ? ORDER BY timestamp DESC LIMIT ?',
            [jid, limit.toString()] // limit must be string or number, prepared statement handles it
        );
        return rows.reverse();
    } catch (error) {
        logError(`Failed to get chat history: ${error.message}`);
        return [];
    }
}

// --- Smart Memory Functions ---

async function addMemory(jid, text) {
    try {
        const [rows] = await pool.execute('SELECT id FROM user_memory WHERE jid = ? AND memory_text = ?', [jid, text]);
        if (rows.length > 0) return true;

        await pool.execute('INSERT INTO user_memory (jid, memory_text, created_at) VALUES (?, ?, ?)', [jid, text, Date.now()]);
        logInfo(`Memory added for ${jid}: ${text}`);
        return true;
    } catch (error) {
        logError(`Failed to add memory: ${error.message}`);
        return false;
    }
}

async function getMemories(jid) {
    try {
        const [rows] = await pool.execute('SELECT memory_text FROM user_memory WHERE jid = ? ORDER BY created_at ASC', [jid]);
        return rows.map(r => r.memory_text);
    } catch (error) {
        logError(`Failed to get memories: ${error.message}`);
        return [];
    }
}

async function removeMemory(jid, query) {
    try {
        const [result] = await pool.execute('DELETE FROM user_memory WHERE jid = ? AND memory_text LIKE ?', [jid, `%${query}%`]);
        if (result.affectedRows > 0) {
            logInfo(`Memory removed for ${jid} matching: ${query}`);
            return true;
        }
        return false;
    } catch (error) {
        logError(`Failed to remove memory: ${error.message}`);
        return false;
    }
}

async function pruneOldestMemory(jid) {
    try {
        // MySQL Delete with Limit requires ordering
        await pool.execute(`
            DELETE FROM user_memory 
            WHERE id = (
                SELECT id FROM (
                    SELECT id FROM user_memory 
                    WHERE jid = ? 
                    ORDER BY created_at ASC 
                    LIMIT 1
                ) as t
            )
        `, [jid]);
        logInfo(`Pruned oldest memory for ${jid}`);
        return true;
    } catch (error) {
        logError(`Failed to prune memory: ${error.message}`);
        return false;
    }
}

module.exports = {
    initializeDatabase,
    performMaintenance,
    getKeyValue,
    setKeyValue,
    setBatchKeyValue,
    getDisabledCommands,
    addDisabledCommand,
    removeDisabledCommand,
    addChatHistory,
    getChatHistory,
    addMemory,
    getMemories,
    removeMemory,
    pruneOldestMemory
};