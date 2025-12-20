const axios = require('axios');
const FormData = require('form-data');
const { logError, logInfo } = require('../logger');

/**
 * Uploads buffer to puruh2o-backend.hf.space and returns the file URL.
 * @param {Buffer} buffer - Image buffer
 * @param {string} filename - Optional filename
 * @returns {Promise<string|null>} - The URL of the uploaded file or null
 */
async function uploadToTmp(buffer, filename = 'image.jpg') {
    try {
        const formData = new FormData();
        formData.append('media', buffer, { filename: filename });

        const response = await axios.post('https://puruh2o-backend.hf.space/upload', formData, {
            headers: {
                ...formData.getHeaders()
            }
        });

        // Response is HTML based on the prompt context:
        // <a href="/uploads/1766059930445-263744554-Screenshot.jpg">Lihat File</a>
        
        const html = response.data;
        const regex = /href="(\/uploads\/[^"]+)"/;
        const match = html.match(regex);

        if (match && match[1]) {
            const fullUrl = `https://puruh2o-backend.hf.space${match[1]}`;
            logInfo(`Image uploaded successfully: ${fullUrl}`);
            return fullUrl;
        }
        
        throw new Error("Could not parse URL from response HTML");

    } catch (error) {
        logError(`Upload Service Error: ${error.message}`);
        return null;
    }
}

module.exports = { uploadToTmp };