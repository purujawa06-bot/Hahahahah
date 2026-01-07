const { apiPost } = require('../../lib/apiHelper'); // Gunakan helper modular

module.exports = {
    cmd: ['tiktok', 'tt', 'tiktokdl'],
    tag: 'downloader',
    help: 'Download video TikTok tanpa watermark',
    run: async (sock, m, { args, config, from }) => {
        const url = args[0];
        if (!url) {
            return await sock.sendMessage(from, { text: '❌ Harap sertakan link TikTok.\nContoh: .tiktok https://vm.tiktok.com/xyz' }, { quoted: m.messages[0] });
        }

        if (!url.match(/tiktok\.com/i)) {
            return await sock.sendMessage(from, { text: '❌ Link tidak valid.' }, { quoted: m.messages[0] });
        }

        await sock.sendMessage(from, { react: { text: '⏳', key: m.messages[0].key } });

        try {
            // Menggunakan apiPost agar otomatis retry 3x jika gagal
            const data = await apiPost(`${config.apiBaseUrl}/api/downloader/tiktok`, { url: url });

            if (!data.success || !data.result) {
                throw new Error(data.message || 'Gagal mendapatkan data video.');
            }

            const detail = data.result.detail;
            
            // Prioritaskan link download, fallback ke play_url
            const videoUrl = detail.download_url || detail.play_url;

            if (!videoUrl) {
                throw new Error('URL video tidak ditemukan dalam respon API.');
            }

            let caption = `🎬 *TIKTOK DOWNLOADER*\n\n`;
            caption += `👤 *Author:* ${detail.author.nickname} (@${detail.author.unique_id})\n`;
            caption += `📝 *Title:* ${detail.title}\n`;
            caption += `⏱️ *Duration:* ${detail.duration}s\n`;
            caption += `📅 *Created:* ${new Date(detail.create_time * 1000).toLocaleDateString()}\n\n`;
            caption += `_${config.footer}_`;

            await sock.sendMessage(from, { 
                video: { url: videoUrl }, 
                caption: caption 
            }, { quoted: m.messages[0] });

            await sock.sendMessage(from, { react: { text: '✅', key: m.messages[0].key } });

        } catch (error) {
            console.error('TikTok DL Error:', error);
            const errorMessage = error.response?.data?.message || error.message;
            await sock.sendMessage(from, { text: `❌ Terjadi kesalahan: ${errorMessage}` }, { quoted: m.messages[0] });
        }
    }
};