const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const { uploadToBackend } = require('../../lib/mediaUploader');

module.exports = {
    cmd: ['edit', 'ghibli'],
    tag: 'tools',
    help: 'Ubah gaya gambar menggunakan AI (Ghibli style default). Usage: .edit <prompt> (caption/reply gambar)',
    run: async (sock, m, { text, from, config }) => {
        const msg = m.messages[0];
        
        // Fungsi helper untuk mendeteksi gambar (Direct atau Quoted)
        const getImageMessage = (message) => {
            // Cek pesan langsung
            if (message?.imageMessage) return message.imageMessage;
            if (message?.viewOnceMessageV2?.message?.imageMessage) return message.viewOnceMessageV2.message.imageMessage;
            if (message?.viewOnceMessage?.message?.imageMessage) return message.viewOnceMessage.message.imageMessage;
            
            // Cek pesan quoted (reply)
            const quoted = message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage) return quoted.imageMessage;
            if (quoted?.viewOnceMessageV2?.message?.imageMessage) return quoted.viewOnceMessageV2.message.imageMessage;
            if (quoted?.viewOnceMessage?.message?.imageMessage) return quoted.viewOnceMessage.message.imageMessage;
            
            return null;
        };

        const targetImage = getImageMessage(msg.message);

        if (!targetImage) {
            return await sock.sendMessage(from, { text: '❌ Harap kirim gambar dengan caption .edit atau reply gambar yang ingin diedit.' }, { quoted: msg });
        }

        const prompt = text || "Jadikan ghibli";

        await sock.sendMessage(from, { react: { text: '🎨', key: msg.key } });

        try {
            // 1. Download Gambar
            const stream = await downloadContentFromMessage(targetImage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            // 2. Upload ke Backend untuk dapat URL publik
            // (API membutuhkan URL gambar sebagai input)
            const imageUrl = await uploadToBackend(buffer);

            // 3. Request ke API SSE (Streaming Response)
            const apiUrl = `${config.apiBaseUrl}/api/tools/ghibli`;
            const response = await axios.post(apiUrl, {
                url: imageUrl,
                prompt: prompt
            }, {
                responseType: 'stream',
                timeout: 60000 // Timeout 60 detik
            });

            // 4. Parsing Stream untuk mencari hasil
            let tempResultUrl = null;

            await new Promise((resolve, reject) => {
                const dataStream = response.data;
                let bufferString = '';

                dataStream.on('data', (chunk) => {
                    bufferString += chunk.toString();
                    const lines = bufferString.split('\n');
                    
                    // Proses setiap baris
                    lines.forEach((line) => {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('[true]')) {
                            const parts = trimmed.split(' ');
                            if (parts.length > 1) {
                                tempResultUrl = parts[1].trim();
                                resolve(); // Stop waiting once URL is found
                            }
                        }
                    });
                    
                    // Keep the last incomplete line in buffer
                    bufferString = lines[lines.length - 1];
                });

                dataStream.on('end', () => {
                    if (!tempResultUrl) reject(new Error('Stream berakhir tanpa URL hasil.'));
                    else resolve();
                });

                dataStream.on('error', (err) => {
                    reject(err);
                });
            });

            if (!tempResultUrl) throw new Error("Gagal mendapatkan link hasil dari server.");

            // 5. Fetch JSON dari URL temporary untuk mendapatkan gambar akhir
            const finalResult = await axios.get(tempResultUrl);
            
            if (!finalResult.data || !finalResult.data.output) {
                throw new Error("Respon JSON hasil tidak valid.");
            }

            const finalImageUrl = finalResult.data.output;

            // 6. Kirim Gambar Hasil
            await sock.sendMessage(from, { 
                image: { url: finalImageUrl }, 
                caption: `✨ *Edit Result*\nPrompt: ${prompt}\nSource: ${finalResult.data.source || 'AI'}` 
            }, { quoted: msg });

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error('Edit AI Error:', error);
            const errorMessage = error.response ? `API Error: ${error.response.status}` : error.message;
            await sock.sendMessage(from, { text: `❌ Gagal mengedit gambar: ${errorMessage}` }, { quoted: msg });
        }
    }
};