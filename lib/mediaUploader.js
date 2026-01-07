const axios = require('axios');
const FormData = require('form-data');
const { logError } = require('./logger');

/**
 * Upload image buffer to Custom Backend and get direct URL.
 * Separated for modularity.
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<string>} - Direct URL of the uploaded image
 */
async function uploadToBackend(buffer) {
    try {
        const form = new FormData();
        // Field name is 'media' based on the HTML form expectation
        form.append('media', buffer, { filename: 'image.jpg' });

        // Menggunakan hardcoded URL backend layanan upload
        // Bisa dipindahkan ke config.js jika ingin lebih dinamis
        const { data } = await axios.post('https://puruh2o-backend.hf.space/upload', form, {
            headers: {
                ...form.getHeaders()
            }
        });

        // Response handling: Extract href from HTML response
        // Format: <body><h2>Upload Berhasil!</h2><a href="/uploads/filename.jpg">Lihat File</a></body>
        const hrefMatch = data.match(/href="([^"]+)"/);
        
        if (hrefMatch && hrefMatch[1]) {
            return `https://puruh2o-backend.hf.space${hrefMatch[1]}`;
        }
        
        throw new Error('Failed to parse upload response (HTML href not found)');
    } catch (error) {
        logError(`Media Upload Error: ${error.message}`);
        throw new Error(`Upload failed: ${error.message}`);
    }
}

module.exports = { uploadToBackend };