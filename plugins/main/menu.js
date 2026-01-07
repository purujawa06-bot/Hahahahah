const { getAllPlugins } = require('../../lib/pluginManager');

module.exports = {
    cmd: ['menu', 'help'],
    tag: 'main',
    help: 'Show all commands',
    run: async (sock, m, { from, pushName, prefix, config }) => {
        const plugins = getAllPlugins();
        const categories = {};
        
        // Group plugins by tag
        plugins.forEach((plugin) => {
            const tag = plugin.tag || 'others';
            if (!categories[tag]) categories[tag] = [];
            // Avoid duplicates if multiple cmds point to same plugin
            const mainCmd = Array.isArray(plugin.cmd) ? plugin.cmd[0] : plugin.cmd;
            if (!categories[tag].find(c => c.cmd === mainCmd)) {
                categories[tag].push({
                    cmd: mainCmd,
                    help: plugin.help || ''
                });
            }
        });

        // Calculate time
        const date = new Date();
        const time = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        // Header
        let menuText = `╭─── [ 🤖 *${config.botName}* ]\n`;
        menuText += `│ 👋 Hi *${pushName}*\n`;
        menuText += `│ 🕒 Time: ${time}\n`;
        menuText += `│ 🔖 Prefix: 「 ${prefix} 」\n`;
        menuText += `╰──────────────────\n\n`;

        // Body
        Object.keys(categories).sort().forEach(category => {
            menuText += `╭── [ *${category.toUpperCase()}* ]\n`;
            categories[category].forEach(cmdInfo => {
                menuText += `│ • ${prefix}${cmdInfo.cmd}\n`;
            });
            menuText += `╰─────────────\n\n`;
        });

        // Footer
        menuText += `_${config.footer}_`;

        // Send
        await sock.sendMessage(from, { 
            text: menuText,
            contextInfo: {
                externalAdReply: {
                    title: config.botName,
                    body: "Simple Plugin Base",
                    thumbnailUrl: `${config.apiBaseUrl}/favicon.jpg`,
                    sourceUrl: config.apiBaseUrl,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: m.messages[0] });
    }
};