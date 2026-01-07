const { setKeyValue, getKeyValue } = require('../../lib/database');
const { groupCache } = require('../../lib/groupCache');

module.exports = {
    cmd: ['antilink'],
    tag: 'group',
    help: 'Enable/Disable anti-group link (Admin Only)',
    run: async (sock, m, { args, from, isGroup }) => {
        if (!isGroup) {
            return await sock.sendMessage(from, { text: '❌ Fitur ini hanya untuk grup!' }, { quoted: m.messages[0] });
        }

        const msg = m.messages[0];
        const sender = msg.key.participant;
        
        // Cek Admin (Menggunakan LRU Cache untuk efisiensi)
        const groupMetadata = await groupCache.get(sock, from);
        const participants = groupMetadata.participants;
        const isAdmin = participants.find(p => p.id === sender)?.admin;

        if (!isAdmin) {
            return await sock.sendMessage(from, { text: '❌ Perintah ini hanya untuk Admin Grup!' }, { quoted: m.messages[0] });
        }

        const mode = args[0]?.toLowerCase();

        if (mode === 'on') {
            await setKeyValue(`antilink_${from}`, true);
            await sock.sendMessage(from, { text: '✅ *Anti-Link Berhasil Diaktifkan!* Bot akan menghapus link grup WhatsApp yang dikirim oleh member bukan admin.' }, { quoted: m.messages[0] });
        } else if (mode === 'off') {
            await setKeyValue(`antilink_${from}`, false);
            await sock.sendMessage(from, { text: '✅ *Anti-Link Berhasil Dinonaktifkan!*' }, { quoted: m.messages[0] });
        } else {
            const currentStatus = await getKeyValue(`antilink_${from}`);
            await sock.sendMessage(from, { 
                text: `🔒 *Status Anti-Link*: ${currentStatus ? 'ON' : 'OFF'}\n\nGunakan:\n.antilink on\n.antilink off` 
            }, { quoted: m.messages[0] });
        }
    }
};