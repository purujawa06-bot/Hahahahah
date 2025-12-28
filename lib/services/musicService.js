const axios = require("axios");
const { logError } = require('../logger');
const { withRetry } = require('../apiHelper');

/**
 * Search and get SoundCloud track info.
 */
async function getSoundCloudTrack(query) {
    try {
        return await withRetry(async () => {
            const response = await axios.get(`https://nexta-api.vercel.app/api/play/soundcloud?q=${encodeURIComponent(query)}`);
            
            if (response.data && response.data.success && response.data.result) {
                return response.data.result; // { title, url, duration, ... }
            }
            throw new Error("SoundCloud API returned unsuccessful response");
        });
    } catch (error) {
        logError(`SoundCloud Error: ${error.message}`);
        // Instead of throwing, we might return null to handle gracefully in message handler
        return null;
    }
}

module.exports = { getSoundCloudTrack };