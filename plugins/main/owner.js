module.exports = {
    cmd: ['owner', 'creator'],
    tag: 'main',
    help: 'Show owner information',
    run: async (sock, m, { from, config }) => {
        const vcard = 'BEGIN:VCARD\n' 
            + 'VERSION:3.0\n' 
            + `FN:${config.ownerName}\n`
            + `ORG:${config.botName};\n`
            + `TEL;type=CELL;type=VOICE;waid=${config.ownerNumber}:${config.ownerNumber}\n`
            + 'END:VCARD';

        await sock.sendMessage(from, { 
            contacts: { 
                displayName: config.ownerName, 
                contacts: [{ vcard }] 
            }
        }, { quoted: m.messages[0] });
    }
};