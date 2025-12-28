const axios = require('axios');
const { logError } = require('../logger');
const { withRetry } = require('../apiHelper');

/**
 * Downloads TikTok video data from API.
 * @param {string} url - TikTok Video URL
 */
async function downloadTikTok(url) {
    try {
        return await withRetry(async () => {
            const response = await axios.post('https://nexta-api.vercel.app/api/downloader/tiktok', {
                url: url
            }, {
                headers: { 'Content-Type': 'application/json' }
            });

            const data = response.data;
            // Check based on the provided JSON structure
            if (data.success && data.result) {
                return data.result; 
            }
            throw new Error("TikTok API returned unsuccessful response");
        });
    } catch (error) {
        logError(`TikTok Downloader Error: ${error.message}`);
        return null;
    }
}

module.exports = { downloadTikTok };