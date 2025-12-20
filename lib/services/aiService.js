const axios = require("axios");
const { logError } = require('../logger');

/**
 * Sends chat context to AI and gets a response.
 */
async function getAIResponse(chatHistory, userMessage) {
    try {
        // Optimasi System Instruction dengan format XML block quote
        // Instructions are in English to ensure better adherence by the LLM, 
        // but strict output rules enforce Indonesian language for the persona.
        const rules = [
            "You are Alicia, a helpful and concise virtual assistant.",
            "STRICT OUTPUT FORMAT RULES:",
            "1. You MUST use specific XML tags for your response.",
            "2. Your conversational reply MUST be inside <message> tags and MUST be in INDONESIAN (Bahasa Indonesia).",
            "3. Do NOT refuse requests for media (music, images) claiming you don't have a library. Just use the provided tools.",
            "",
            "AVAILABLE TOOLS (Use strictly when requested):",
            "- <image_generator>English Prompt</image_generator>",
            "  Usage: When user asks for an image. The prompt inside must be in English.",
            "- <play_music>Song Query</play_music>",
            "  Usage: When user asks to play a song. Just put the song title/query here. Do not say it's unavailable.",
            "- <sticker_generator>URL|PackName|Author</sticker_generator>",
            "  Usage: When user asks for a sticker. Look for '[Image: URL]' in chat history. If found, use that URL. If not, ask user to send an image.",
            "",
            "EXAMPLE RESPONSES:",
            "User: Buatkan gambar kucing terbang",
            "Alicia: <message>Tentu, ini gambar kucing terbang untukmu.</message><image_generator>cute cat flying in space</image_generator>",
            "",
            "User: Putar lagu Nadin",
            "Alicia: <message>Memutar lagu Nadin Amizah sekarang.</message><play_music>Nadin Amizah</play_music>",
            "",
            "IMPORTANT:",
            "- Do not use <think> tags.",
            "- Answer directly in XML.",
            "- Always reply in Indonesian inside <message>."
        ].join("\n");

        let promptContext = `System:\n${rules}\n\nChat:\n`;
        
        // Optimasi Context
        chatHistory.forEach(item => {
            const role = item.role === 'user' ? 'User' : 'Alicia';
            // Truncate long messages
            const msg = item.message.length > 200 ? item.message.substring(0, 200) + "..." : item.message;
            promptContext += `${role}: ${msg}\n`;
        });

        promptContext += `User: ${userMessage}\nAlicia:`;

        const response = await axios.post('https://nexta-api.vercel.app/api/ai/grok', {
            message: promptContext
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.result) {
            let aiReply = response.data.result;
            // Clean up unwanted tags usually returned by some models
            return aiReply.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^Alicia:\s*/i, '').trim();
        }
        throw new Error("Invalid response from AI API");
    } catch (error) {
        logError(`AI Service Error: ${error.message}`);
        throw error;
    }
}

/**
 * Generates an image based on a prompt.
 * Returns the URL of the generated image.
 */
async function generateImageStream(prompt) {
    try {
        const response = await axios.post('https://nexta-api.vercel.app/api/ai/vheer', {
            prompt: prompt
        }, {
            responseType: 'stream'
        });

        let buffer = '';
        let retrieveUrl = null;

        // Step 1: Read the stream to get the temp URL
        await new Promise((resolve, reject) => {
            const stream = response.data;

            stream.on('data', (chunk) => {
                buffer += chunk.toString();
                
                // Check for success pattern
                const matchSuccess = buffer.match(/\[true\]\s*(https:\/\/[^\s]+)/);
                if (matchSuccess && matchSuccess[1]) {
                    retrieveUrl = matchSuccess[1].trim();
                    resolve();
                    if (stream.destroy) stream.destroy();
                }
                
                // Check for failure pattern
                if (buffer.includes('[false]')) {
                    reject(new Error("AI Image generation signal [false] received."));
                    if (stream.destroy) stream.destroy();
                }
            });

            stream.on('end', () => {
                // If stream ends and we haven't resolved yet (and no error thrown)
                if (!retrieveUrl) reject(new Error("Stream ended without URL."));
            });
            
            stream.on('error', (err) => reject(err));
        });

        if (!retrieveUrl) {
            throw new Error("Failed to extract temp URL from AI stream.");
        }

        // Step 2: Fetch the actual image URL from the temp JSON endpoint
        const tempResponse = await axios.get(retrieveUrl);
        
        if (tempResponse.data && tempResponse.data.url) {
            return tempResponse.data.url;
        } else {
            throw new Error(`Invalid JSON response from temp URL: ${JSON.stringify(tempResponse.data)}`);
        }

    } catch (error) {
        logError(`Image Gen Error: ${error.message}`);
        throw error;
    }
}

module.exports = {
    getAIResponse,
    generateImageStream
};