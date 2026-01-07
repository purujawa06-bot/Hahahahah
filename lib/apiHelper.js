const axios = require('axios');
const { logWarning, logError } = require('./logger');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wraps an asynchronous function with retry logic.
 * @param {Function} fn - The async function to execute (must return a Promise).
 * @param {number} retries - Maximum number of retries (default: 3).
 * @param {number} delay - Delay between retries in ms (default: 2000).
 * @returns {Promise<any>} - The result of the function.
 */
async function withRetry(fn, retries = 3, delay = 2000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const isLastAttempt = i === retries - 1;
            if (!isLastAttempt) {
                // Log only essential info to keep console clean
                const errMsg = error.response ? `Status ${error.response.status}` : error.message;
                logWarning(`API Request failed (${errMsg}). Retrying (${i + 1}/${retries})...`);
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

/**
 * Helper for POST requests with built-in retry logic.
 * @param {string} url - Endpoint URL
 * @param {object} data - Request body
 * @param {object} config - Axios config (headers, etc)
 * @param {number} retries - Max retries (default: 3)
 */
async function apiPost(url, data, config = {}, retries = 3) {
    return withRetry(async () => {
        const response = await axios.post(url, data, config);
        return response.data;
    }, retries);
}

/**
 * Helper for GET requests with built-in retry logic.
 * @param {string} url - Endpoint URL
 * @param {object} config - Axios config
 * @param {number} retries - Max retries (default: 3)
 */
async function apiGet(url, config = {}, retries = 3) {
    return withRetry(async () => {
        const response = await axios.get(url, config);
        return response.data;
    }, retries);
}

module.exports = { withRetry, apiPost, apiGet };