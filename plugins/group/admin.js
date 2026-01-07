const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { groupCache } = require('../../lib/groupCache');

module.exports = {
    cmd: ['promote', 'demote'],
    tag: 'group',
    help: 'Promote (Jadikan Admin) atau Demote (Jadikan Member)',
    run: async (sock, m, { args, from, isGroup, command }) => {
        if (!isGroup) {
            return await sock.sendMessage(from, { text: '❌ Fitur ini hanya untuk grup!' }, { quoted: m.messages[0] });
        }

        const msg = m.messages[0];
        const sender = msg.key.participant;
        
        // 1. Ambil Metadata Grup (gunakan cache)
        const groupMetadata = await groupCache.get(sock, from);
        const participants = groupMetadata.participants;
        
        // 2. Cek apakah Pengirim adalah Admin
        // Gunakan jidNormalizedUser untuk perbandingan yang aman
        const senderId = jidNormalizedUser(sender);
        const senderAdmin = participants.find(p => jidNormalizedUser(p.id) === senderId)?.admin;
        
        if (!senderAdmin) {
            return await sock.sendMessage(from, { text: '❌ Perintah ini hanya untuk Admin Grup!' }, { quoted: msg });
        }

        // 3. Cek apakah Bot adalah Admin
        // FIX: Normalize ID and LID before comparison to handle device suffixes (e.g., :14)
        const me = sock.authState.creds.me;
        const botId = me?.id || sock.user?.id;
        const botLid = me?.lid || sock.user?.lid;

        const botJid = jidNormalizedUser(botId);
        const botLidJid = botLid ? jidNormalizedUser(botLid) : null;
        
        // Cek admin dengan support LID (Normalized)
        const botParticipant = participants.find(p => {
            const pId = jidNormalizedUser(p.id);
            return pId === botJid || (botLidJid && pId === botLidJid);
        });
        
        const botAdmin = botParticipant?.admin;

        if (!botAdmin) {
            return await sock.sendMessage(from, { text: '❌ Bot harus menjadi Admin untuk melakukan tindakan ini!' }, { quoted: msg });
        }

        // 4. Tentukan Target User
        let target;
        const quoted = msg.message?.extendedTextMessage?.contextInfo;
        
        if (quoted?.participant) {
            // Target dari Reply Pesan
            target = quoted.participant;
        } else if (quoted?.mentionedJid?.length > 0) {
            // Target dari Tag/Mention
            target = quoted.mentionedJid[0];
        } else if (args.length > 0) {
            // Target dari Input Nomor (argument pertama)
            const number = args[0].replace(/[^0-9]/g, '');
            if (number.length > 5) {
                target = number + '@s.whatsapp.net';
            }
        }

        if (!target) {
            return await sock.sendMessage(from, { text: `❌ Harap tentukan user.\n\nCaranya:\n- Reply pesan user\n- Tag user (@user)\n- Atau ketik nomor (contoh: .${command} 628xxx)` }, { quoted: msg });
        }

        // Cek agar tidak menargetkan diri sendiri atau bot (opsional, tapi bagus untuk UX)
        // Bandingkan target yang dinormalisasi dengan botJid
        const targetJid = jidNormalizedUser(target);
        if (targetJid === botJid) {
             return await sock.sendMessage(from, { text: '❌ Tidak bisa mengubah status Bot sendiri.' }, { quoted: msg });
        }

        // 5. Eksekusi Promote/Demote
        try {
            const action = command === 'promote' ? 'promote' : 'demote';
            await sock.groupParticipantsUpdate(from, [target], action);
            
            // Invalidate cache agar data admin terbaru segera terupdate saat dicek ulang
            groupCache.invalidate(from);

            let text = '';
            if (action === 'promote') {
                text = `✅ Sukses! @${target.split('@')[0]} sekarang adalah Admin.`;
            } else {
                text = `✅ Sukses! @${target.split('@')[0]} diturunkan menjadi Member.`;
            }

            await sock.sendMessage(from, { text, mentions: [target] }, { quoted: msg });

        } catch (error) {
            console.error(`Group Admin Action Error (${command}):`, error);
            await sock.sendMessage(from, { text: `❌ Gagal melakukan perubahan: ${error.message}` }, { quoted: msg });
        }
    }
};