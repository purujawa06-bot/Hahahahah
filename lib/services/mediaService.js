const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const axios = require('axios');

/**
 * Fungsi untuk mengubah media (Image/Video) dari pesan atau URL menjadi Stiker
 * @param {object} sock - Socket WhatsApp (Baileys instance)
 * @param {object} msg - Objek pesan asli
 * @param {object} options - Opsi: { pack, author, url }
 */
async function convertMediaToSticker(sock, msg, options = {}) {
    const from = msg.key.remoteJid;
    const packName = options.pack || 'NextA Bot';
    const authorName = options.author || 'Sticker';
    const targetUrl = options.url;

    try {
        let buffer;

        await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

        if (targetUrl && targetUrl.startsWith('http')) {
            // CASE 1: Membuat sticker dari URL (Logic Baru)
            try {
                const response = await axios.get(targetUrl, { responseType: 'arraybuffer' });
                buffer = response.data;
            } catch (err) {
                console.error('Failed to download image from URL:', err);
                await sock.sendMessage(from, { text: '❌ Gagal mengunduh gambar dari URL history.' }, { quoted: msg });
                return false;
            }
        } else {
            // CASE 2: Membuat sticker dari Message/Quoted (Logic Lama/Fallback)
            const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMessage = quotedMessage ? { message: quotedMessage } : msg;

            const messageContent = targetMessage.message;
            const imageMessage = messageContent?.imageMessage || messageContent?.viewOnceMessage?.message?.imageMessage || messageContent?.viewOnceMessageV2?.message?.imageMessage;
            const videoMessage = messageContent?.videoMessage || messageContent?.viewOnceMessage?.message?.videoMessage || messageContent?.viewOnceMessageV2?.message?.videoMessage;

            if (!imageMessage && !videoMessage) {
                // Tidak ada media sama sekali
                return false;
            }

            if (videoMessage && videoMessage.seconds > 10) {
                await sock.sendMessage(from, { text: '⚠️ Durasi video terlalu panjang! Maksimal 10 detik.' }, { quoted: msg });
                return true; 
            }

            buffer = await downloadMediaMessage(
                targetMessage,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage
                }
            );
        }

        // Proses pembuatan stiker
        const sticker = new Sticker(buffer, {
            pack: packName,
            author: authorName,
            type: StickerTypes.FULL, 
            categories: ['🤩', '🎉'],
            quality: 50
        });

        const generatedSticker = await sticker.toMessage();
        await sock.sendMessage(from, generatedSticker, { quoted: msg });
        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

        return true;

    } catch (error) {
        console.error('Error creating sticker:', error);
        await sock.sendMessage(from, { text: '❌ Gagal membuat stiker. Terjadi kesalahan internal.' }, { quoted: msg });
        return false;
    }
}

module.exports = { convertMediaToSticker };