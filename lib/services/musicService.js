const axios = require("axios");
const { logError } = require('../logger');

/**
 * Search and get SoundCloud track info.
 */
async function getSoundCloudTrack(query) {
    try {
        const response = await axios.get(`https://nexta-api.vercel.app/api/play/soundcloud?q=${encodeURIComponent(query)}`);
        
        if (response.data && response.data.success && response.data.result) {
            return response.data.result; // { title, url, duration, ... }
        }
        return null;
    } catch (error) {
        logError(`SoundCloud Error: ${error.message}`);
        throw error;
    }
}

module.exports = { getSoundCloudTrack };