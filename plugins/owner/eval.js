const util = require('util');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');

module.exports = {
    cmd: ['eval'],
    tag: 'owner',
    help: 'Run JavaScript code (Debugging)',
    run: async (sock, m, { args, text, from, isGroup, config, pushName, command, sender }) => {
        // --- Owner Verification Logic ---
        
        // 1. Get Normalized Sender JID
        const rawSender = sender || m.messages[0].key.participant || m.messages[0].key.remoteJid;
        const senderJid = jidNormalizedUser(rawSender);
        
        // 2. Construct Owner JIDs from Config
        const ownerPhoneJid = jidNormalizedUser(config.ownerNumber + '@s.whatsapp.net');
        const ownerLidJid = config.ownerLid ? jidNormalizedUser(config.ownerLid) : null;
        
        // 3. Get Bot's JIDs (to allow the bot account itself to be an owner)
        const botId = sock.user?.id || sock.authState.creds.me?.id;
        const botPhoneJid = botId ? jidNormalizedUser(botId) : null;
        const botLidJid = sock.authState.creds.me?.lid ? jidNormalizedUser(sock.authState.creds.me.lid) : null;

        // 4. Check Match
        // We match against Config Owner Phone, Config Owner LID, Bot Phone, or Bot LID.
        const isOwner = 
            senderJid === ownerPhoneJid || 
            (ownerLidJid && senderJid === ownerLidJid) ||
            senderJid === botPhoneJid || 
            senderJid === botLidJid;

        // Debugging / Rejection
        if (!isOwner) {
            console.log(`[Eval] Access Denied. Sender: ${senderJid}`);
            console.log(`[Eval] Allowed: ${ownerPhoneJid}, ${ownerLidJid}`);
            
            return await sock.sendMessage(from, { 
                text: `❌ Access Denied: Command ini hanya untuk Owner!\n\nDetected ID: ${senderJid}\nRequired: ${config.ownerNumber} (or configured LID)` 
            }, { quoted: m.messages[0] });
        }

        if (!text) return await sock.sendMessage(from, { text: '❓ Provide code to evaluate.' }, { quoted: m.messages[0] });

        try {
            // Evaluasi code
            // Variabel yang tersedia: sock, m, config, from, dll.
            let evaled = await eval(text);

            if (typeof evaled !== 'string') {
                evaled = util.inspect(evaled);
            }

            await sock.sendMessage(from, { text: `${evaled}` }, { quoted: m.messages[0] });
        } catch (err) {
            await sock.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: m.messages[0] });
        }
    }
};