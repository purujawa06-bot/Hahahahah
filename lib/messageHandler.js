const { getContentType, downloadMediaMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const { logInfo, logError } = require('./logger');
const { addChatHistory, getChatHistory } = require('./database');

// Import modular services
const aiService = require('./services/aiService');
const musicService = require('./services/musicService');
const mediaService = require('./services/mediaService');
const { uploadToTmp } = require('./services/uploadService');

/**
 * Parses the message body from various message types.
 */
function parseBody(message) {
    if (!message) return '';
    
    let type = getContentType(message);
    if (!type) return '';
    
    if (type === 'ephemeralMessage' || type === 'viewOnceMessage' || type === 'viewOnceMessageV2') {
        if (message[type] && message[type].message) {
            message = message[type].message;
            type = getContentType(message);
        }
    }
    
    const messageContent = message[type];
    if (!messageContent) return '';

    if (type === 'conversation') {
        return messageContent;
    }

    return messageContent.text || messageContent.caption || messageContent.conversation || '';
}

/**
 * Handles static commands (non-AI).
 */
async function handleStaticCommands(sock, from, body, msg) {
    const cmd = body.toLowerCase().trim();
    
    if (['.help', '.menu', 'help', 'bantuan', 'menu', '.start'].includes(cmd)) {
        const helpText = `🤖 *NextA Bot Help Center*

Halo! Saya Alicia. Berikut adalah panduan singkat penggunaan bot:

💬 *Chatting*
Tanya apa saja seperti biasa. Saya akan menjawab pertanyaanmu.

🎨 *Generate Gambar*
Ketik: "Buatkan gambar [deskripsi]"
Contoh: "Buatkan gambar kucing terbang di angkasa"

🎵 *Putar Musik*
Ketik: "Putar lagu [judul]"
Contoh: "Putar lagu Nadin Amizah Bertaut"

🖼️ *Buat Stiker*
- Kirim gambar dengan caption "buatkan stiker"
- Atau reply gambar dengan ketik "buat stiker"

_Powered by NextA AI & Firebase_`;
        
        await sock.sendMessage(from, { text: helpText }, { quoted: msg });
        return true;
    }

    if (cmd === '.ping' || cmd === 'ping') {
        await sock.sendMessage(from, { text: 'Pong! 🏓\nBot is online (Firebase Connected).' }, { quoted: msg });
        return true;
    }

    return false;
}

/**
 * Process AI Triggers
 */
async function processAiTriggers(sock, from, aiText, originalMsg) {
    const msgRegex = /<message>([\s\S]*?)<\/message>/i;
    const imgRegex = /<image_generator>([\s\S]*?)<\/image_generator>/i;
    const musicRegex = /<play_music>([\s\S]*?)<\/play_music>/i;
    const stickerRegex = /<sticker_generator>([\s\S]*?)<\/sticker_generator>/i;

    let replyText = "";
    let imagePrompt = null;
    let musicQuery = null;
    let stickerParams = null;

    const msgMatch = aiText.match(msgRegex);
    if (msgMatch) {
        replyText = msgMatch[1].trim();
    } else {
        if (!imgRegex.test(aiText) && !musicRegex.test(aiText) && !stickerRegex.test(aiText)) {
             replyText = aiText;
        } else {
            let residual = aiText
                .replace(imgRegex, '')
                .replace(musicRegex, '')
                .replace(stickerRegex, '')
                .trim();
            if (residual) replyText = residual;
        }
    }

    const imgMatch = aiText.match(imgRegex);
    if (imgMatch) imagePrompt = imgMatch[1].trim();

    const musicMatch = aiText.match(musicRegex);
    if (musicMatch) musicQuery = musicMatch[1].trim();

    const stickerMatch = aiText.match(stickerRegex);
    if (stickerMatch) stickerParams = stickerMatch[1].trim();

    if (!replyText && (imagePrompt || musicQuery || stickerParams)) {
        replyText = "Sedang memproses permintaanmu...";
    } else if (!replyText) {
        replyText = "Maaf, saya tidak mengerti respons tersebut.";
    }

    if (replyText) {
        await sock.sendMessage(from, { text: replyText }, { quoted: originalMsg });
    }

    if (imagePrompt) await handleImageGeneration(sock, from, imagePrompt, originalMsg);
    if (musicQuery) await handleMusicRequest(sock, from, musicQuery, originalMsg);
    if (stickerParams) await handleStickerRequest(sock, from, stickerParams, originalMsg);
    
    return replyText; 
}

async function handleImageGeneration(sock, from, prompt, quotedMsg) {
    try {
        await sock.sendMessage(from, { react: { text: "🎨", key: quotedMsg.key } });
        const imageUrl = await aiService.generateImageStream(prompt);
        
        await sock.sendMessage(from, { 
            image: { url: imageUrl }, 
            caption: `🎨 ${prompt}` 
        }, { quoted: quotedMsg });
        
        await sock.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });
        await addChatHistory(from, 'ai', `[Image created successfully for prompt: ${prompt}]`);
    } catch (error) {
        logError(`Image Gen Handler Error: ${error.message}`);
        await sock.sendMessage(from, { text: "⚠️ Maaf, gagal membuat gambar saat ini." }, { quoted: quotedMsg });
        await sock.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
    }
}

async function handleMusicRequest(sock, from, query, quotedMsg) {
    try {
        await sock.sendMessage(from, { react: { text: "🎵", key: quotedMsg.key } });
        const track = await musicService.getSoundCloudTrack(query);
        
        if (track) {
            await sock.sendMessage(from, { 
                audio: { url: track.url }, 
                mimetype: 'audio/mp4',
                caption: `🎵 *${track.title}* (${track.duration})`
            }, { quoted: quotedMsg });
            await sock.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });
            await addChatHistory(from, 'ai', `[Music played successfully: ${track.title}]`);
        } else {
            await sock.sendMessage(from, { text: "⚠️ Lagu tidak ditemukan." }, { quoted: quotedMsg });
            await sock.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
        }
    } catch (error) {
        logError(`Music Handler Error: ${error.message}`);
        await sock.sendMessage(from, { text: "⚠️ Gagal memproses musik." }, { quoted: quotedMsg });
        await sock.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
    }
}

async function handleStickerRequest(sock, from, params, originalMsg) {
    const parts = params.split('|').map(s => s.trim());
    let url = null;
    let pack = 'NextA Bot';
    let author = 'Sticker';

    if (parts.length > 0 && parts[0].startsWith('http')) {
        url = parts[0];
        pack = parts[1] || pack;
        author = parts[2] || author;
    } else {
        pack = parts[0] || pack;
        author = parts[1] || author;
    }
    
    const success = await mediaService.convertMediaToSticker(sock, originalMsg, { pack, author, url });

    if (!success) {
        await sock.sendMessage(from, { text: "⚠️ Tidak dapat memproses stiker." }, { quoted: originalMsg });
        await sock.sendMessage(from, { react: { text: "❌", key: originalMsg.key } });
    } else {
        await addChatHistory(from, 'ai', '[Sticker created successfully]');
    }
}

/**
 * Main Message Handler Entry Point
 */
async function handleMessage(sock, m) {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;
    if (msg.key.remoteJid === 'status@broadcast') return;

    const from = msg.key.remoteJid;
    const type = getContentType(msg.message);
    let body = parseBody(msg.message);
    body = body ? body.trim() : '';

    if (body) {
        const processed = await handleStaticCommands(sock, from, body, msg);
        if (processed) return;
    }

    let uploadedUrl = null;
    const isImage = (type === 'imageMessage') || 
                    (type === 'viewOnceMessage' && msg.message.viewOnceMessage.message?.imageMessage) ||
                    (type === 'viewOnceMessageV2' && msg.message.viewOnceMessageV2.message?.imageMessage);

    if (isImage) {
        try {
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            uploadedUrl = await uploadToTmp(buffer);
            if (uploadedUrl) logInfo(`Image auto-uploaded: ${uploadedUrl}`);
        } catch (e) {
            logError(`Failed to auto-upload image: ${e.message}`);
        }
    }

    let userMessage = body;
    if (!userMessage && uploadedUrl) userMessage = "ini gambar apa?";
    else if (!userMessage && !uploadedUrl) return;
    
    if (uploadedUrl) userMessage = `[Image: ${uploadedUrl}] ${userMessage}`;

    logInfo(`Incoming: ${userMessage} from ${from}`);
    
    await sock.readMessages([msg.key]);
    await sock.sendPresenceUpdate('composing', from);

    try {
        // ASYNC DB CALLS
        const history = await getChatHistory(from, 10);
        const rawAiReply = await aiService.getAIResponse(history, userMessage);

        await addChatHistory(from, 'user', userMessage);
        
        const finalReplyText = await processAiTriggers(sock, from, rawAiReply, msg);
        
        await addChatHistory(from, 'ai', finalReplyText);

    } catch (error) {
        logError(`Handler Exception: ${error.message}`);
    }
}

module.exports = { handleMessage };