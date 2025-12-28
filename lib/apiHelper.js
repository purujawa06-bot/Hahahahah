const { logWarning } = require('./logger');

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
            // Don't retry on 4xx errors usually, but here we retry all network issues.
            // You might want to filter 400/404 if strictly needed, but for stability we retry generic failures.
            const isLastAttempt = i === retries - 1;
            if (!isLastAttempt) {
                logWarning(`API Request failed: ${error.message}. Retrying (${i + 1}/${retries})...`);
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

module.exports = { withRetry };