const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { getChatHistory, addChatHistory } = require('../../lib/database');
const { apiPost } = require('../../lib/apiHelper'); // Modular API helper dengan Retry
const { uploadToBackend } = require('../../lib/mediaUploader'); // Modular Uploader

module.exports = {
    cmd: ['ai', 'alicia', 'grok'],
    tag: 'ai',
    help: 'Chat dengan Alicia AI (Text & Vision Integrated)',
    run: async (sock, m, { text, from, pushName, config }) => {
        const msg = m.messages[0];
        
        // --- Cek apakah ada gambar (ImageMessage/ViewOnce) ---
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        const getImageMessage = (message) => {
            if (message?.imageMessage) return message.imageMessage;
            if (message?.viewOnceMessageV2?.message?.imageMessage) return message.viewOnceMessageV2.message.imageMessage;
            if (message?.viewOnceMessage?.message?.imageMessage) return message.viewOnceMessage.message.imageMessage;
            return null;
        };

        const targetImage = getImageMessage(msg.message) || getImageMessage(quoted);
        
        // Reaksi awal
        await sock.sendMessage(from, { react: { text: '💭', key: msg.key } });

        let visualContext = "";
        let userMessage = text;

        // --- Logika Analisa Gambar (Vision) ---
        if (targetImage) {
            try {
                await sock.sendMessage(from, { react: { text: '👀', key: msg.key } });

                // 1. Download Gambar
                const stream = await downloadContentFromMessage(targetImage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // 2. Upload ke Backend (Modular)
                const imageUrl = await uploadToBackend(buffer);

                // 3. Analisa Visual
                // UPDATE: Gunakan text user sebagai prompt jika ada, agar fokus ke detail yang diminta.
                const visionPrompt = text 
                    ? `Please analyze this image specifically focusing on this request: "${text}". Describe it in detail relevant to the request.`
                    : "Describe this image in detail.";

                // Menggunakan apiPost dengan auto-retry (max 3)
                const data = await apiPost(`${config.apiBaseUrl}/api/ai/screenapp`, {
                    url: imageUrl,
                    question: visionPrompt
                });

                if (data.success && data.result) {
                    visualContext = `[System Note: User melampirkan gambar. Deskripsi Visual AI (berdasarkan prompt "${visionPrompt}"): ${data.result.answer}]`;
                } else {
                    visualContext = `[System Note: User melampirkan gambar, tetapi gagal dianalisis oleh Vision AI.]`;
                }
                
                // Jika user tidak mengetik teks, kita buat seolah user bertanya tentang gambar
                if (!userMessage) {
                    userMessage = "Apa yang kamu lihat di gambar ini?";
                }

                await sock.sendMessage(from, { react: { text: '🧠', key: msg.key } });

            } catch (error) {
                console.error('Image Analysis Error:', error);
                await sock.sendMessage(from, { text: `❌ Gagal memproses gambar: ${error.message}` }, { quoted: msg });
                return;
            }
        }

        // Jika tidak ada gambar dan tidak ada teks
        if (!userMessage && !visualContext) {
            return await sock.sendMessage(from, { text: 'Halo! Saya Alicia AI.\n\n- Ketik pesan untuk ngobrol.\n- Kirim/Reply gambar untuk analisa visual bersama saya.' }, { quoted: msg });
        }

        // --- Logika Chat Alicia (Unified) ---
        try {
            // 1. Ambil 5 pesan terakhir
            const history = await getChatHistory(from, 5);

            // 2. Gabungkan visual context dengan pesan user saat ini
            const fullInput = visualContext ? `${visualContext}\n\n${userMessage}` : userMessage;

            // 3. Susun Prompt Context
            let contextPrompt = "System: Nama kamu adalah Alicia AI. Kamu adalah asisten cerdas yang bisa melihat gambar dan mengobrol. Jawablah pertanyaan user dengan SINGKAT, padat, dan jelas. Jangan bertele-tele.\n\nRiwayat Percakapan:\n";

            history.forEach(msgItem => {
                if (msgItem.role === 'system' || (msgItem.message && msgItem.message.startsWith('Executed:'))) return;
                const speaker = msgItem.role === 'assistant' ? 'Alicia' : 'User';
                contextPrompt += `${speaker}: ${msgItem.message}\n`;
            });

            contextPrompt += `User: ${fullInput}\nAlicia:`;

            // 4. Request ke API Grok (LLM) dengan Retry Logic
            const data = await apiPost(`${config.apiBaseUrl}/api/ai/grok`, {
                message: contextPrompt
            });

            if (data.success && data.result) {
                const aiResponse = data.result;

                await sock.sendMessage(from, { text: aiResponse }, { quoted: msg });

                // Simpan history
                await addChatHistory(from, 'user', fullInput, pushName);
                await addChatHistory(from, 'assistant', aiResponse, 'Alicia AI');

                await sock.sendMessage(from, { react: { text: '✨', key: msg.key } });
            } else {
                throw new Error('Gagal mendapatkan respon valid dari API.');
            }

        } catch (error) {
            console.error('Alicia AI Error:', error);
            await sock.sendMessage(from, { text: `❌ Error: ${error.message}` }, { quoted: msg });
        }
    }
};