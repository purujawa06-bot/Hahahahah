module.exports = {
    cmd: ['ping', 'p'],
    tag: 'main',
    help: 'Check bot status',
    run: async (sock, m, { from }) => {
        const start = Date.now();
        await sock.sendMessage(from, { text: 'Pong! 🏓' }, { quoted: m.messages[0] });
        const end = Date.now();
        // You could update the message with latency if desired
    }
};