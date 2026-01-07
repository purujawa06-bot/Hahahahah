const { logInfo } = require('./logger');

/**
 * Simple LRU (Least Recently Used) Cache for Group Metadata.
 * Reduces API calls to WhatsApp servers and improves performance.
 */
class GroupMetadataCache {
    constructor() {
        this.cache = new Map();
        this.TTL = 60 * 1000; // 60 Seconds Time-To-Live
        this.MAX_SIZE = 100; // Max number of groups to hold in memory
    }

    /**
     * Get group metadata with caching strategy.
     * @param {object} sock - The WASocket instance
     * @param {string} jid - Group JID
     * @returns {Promise<object>} Group Metadata
     */
    async get(sock, jid) {
        const now = Date.now();
        
        // 1. Check if exists in cache
        if (this.cache.has(jid)) {
            const item = this.cache.get(jid);
            
            // 2. Check if expired
            if (now < item.expiry) {
                // LRU Logic: Delete and re-set to move to the end (most recently used)
                this.cache.delete(jid);
                this.cache.set(jid, item);
                return item.data;
            } else {
                // Expired
                this.cache.delete(jid);
            }
        }

        // 3. Fetch from API if not in cache or expired
        try {
            // logInfo(`Fetching fresh metadata for ${jid}`);
            const data = await sock.groupMetadata(jid);
            
            // LRU Logic: If full, prune the oldest (first item in Map)
            if (this.cache.size >= this.MAX_SIZE) {
                const oldestKey = this.cache.keys().next().value;
                this.cache.delete(oldestKey);
            }

            // Save to cache
            this.cache.set(jid, {
                data,
                expiry: now + this.TTL
            });

            return data;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Manually invalidate a group's cache (e.g., on participant update events)
     * @param {string} jid 
     */
    invalidate(jid) {
        this.cache.delete(jid);
    }
}

// Singleton instance
const groupCache = new GroupMetadataCache();
module.exports = { groupCache };