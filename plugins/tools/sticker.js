const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

module.exports = {
    cmd: ['sticker', 's', 'stiker'],
    tag: 'tools',
    help: 'Convert image/video to sticker',
    run: async (sock, m, { from, config }) => {
        try {
            const msg = m.messages[0];
            let messageType = Object.keys(msg.message)[0];
            let messageContent = msg.message[messageType];

            // Handle quoted message
            if (messageType === 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo?.quotedMessage) {
                const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                const quotedType = Object.keys(quotedMessage)[0];
                
                if (quotedType === 'imageMessage' || quotedType === 'videoMessage') {
                    messageType = quotedType;
                    messageContent = quotedMessage[quotedType];
                }
            }

            if (messageType !== 'imageMessage' && messageType !== 'videoMessage') {
                return await sock.sendMessage(from, { text: '❌ Kirim gambar/video dengan caption .sticker atau reply gambar/video.' }, { quoted: msg });
            }

            // React while processing
            await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } });

            // Download Media
            const streamType = messageType.replace('Message', '');
            const stream = await downloadContentFromMessage(messageContent, streamType);
            
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            // Convert to Sticker
            const sticker = new Sticker(buffer, {
                pack: config.botName || 'NextA Bot',
                author: config.ownerName || 'PuruBoy',
                type: StickerTypes.FULL,
                quality: 50 // Moderate quality
            });

            const result = await sticker.toBuffer();

            // Send Sticker
            await sock.sendMessage(from, { sticker: result }, { quoted: msg });

        } catch (error) {
            console.error('Sticker Error:', error);
            await sock.sendMessage(from, { text: `❌ Gagal membuat sticker: ${error.message}` }, { quoted: m.messages[0] });
        }
    }
};