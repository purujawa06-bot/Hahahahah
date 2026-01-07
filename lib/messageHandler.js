const { getContentType, jidNormalizedUser } = require("@whiskeysockets/baileys");
const { logInfo, logError } = require('./logger');
const { getPlugin } = require('./pluginManager');
const { addChatHistory, getKeyValue } = require('./database');
const { groupCache } = require('./groupCache');
const { withRetry } = require('./apiHelper');
const config = require('../config');

/**
 * Utility: Sleep function for delays
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Utility: Generate random number between min and max
 */
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Parses the message body.
 */
function parseBody(message) {
    if (!message) return '';
    const type = getContentType(message);
    if (!type) return '';
    
    if (type === 'conversation') return message.conversation;
    if (type === 'imageMessage') return message.imageMessage.caption;
    if (type === 'videoMessage') return message.videoMessage.caption;
    if (type === 'extendedTextMessage') return message.extendedTextMessage.text;
    
    return '';
}

/**
 * Main Message Handler Entry Point
 */
async function handleMessage(sock, m) {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;
    if (msg.key.remoteJid === 'status@broadcast') return;

    // Auto Read Logic
    if (config.autoRead) {
        try {
            await sock.readMessages([msg.key]);
        } catch (error) {
            // Silently ignore read errors to not disrupt flow
        }
    }

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const pushName = msg.pushName || "User";
    
    // Determine sender correctly (Phone JID or LID)
    // Fix: Pastikan sender terambil baik dari participant (grup) atau remoteJid (private)
    const sender = isGroup ? (msg.key.participant || from) : from;
    
    // Get Body and Prefix
    let body = parseBody(msg.message);
    if (!body) return;
    body = body.trim();

    // --- ANTI-LINK SYSTEM START ---
    // Cek jika grup dan ada link WhatsApp
    if (isGroup && (body.match(/chat\.whatsapp\.com\//) || body.match(/wa\.me\//))) {
        try {
            const isAntiLinkActive = await getKeyValue(`antilink_${from}`);
            
            if (isAntiLinkActive) {
                // Ambil metadata grup (Optimized with LRU Cache)
                const groupMetadata = await groupCache.get(sock, from);
                const participants = groupMetadata.participants;
                const senderId = jidNormalizedUser(sender);
                
                // Cek apakah pengirim adalah admin
                const isAdmin = participants.find(p => jidNormalizedUser(p.id) === senderId)?.admin;
                
                // Ambil ID Bot yang benar (support versi Baileys baru & LID)
                // FIX: Normalize ID and LID before comparison to handle device suffixes (e.g., :14)
                const me = sock.authState.creds.me;
                const botId = me?.id || sock.user?.id;
                const botLid = me?.lid || sock.user?.lid;

                const botJid = jidNormalizedUser(botId);
                const botLidJid = botLid ? jidNormalizedUser(botLid) : null;
                
                // Cek apakah bot ada di list participant (cek Phone JID dan LID)
                const botParticipant = participants.find(p => {
                    const pId = jidNormalizedUser(p.id);
                    return pId === botJid || (botLidJid && pId === botLidJid);
                });
                const isBotAdmin = botParticipant?.admin;

                // Jika pengirim bukan admin, hapus pesan
                if (!isAdmin) {
                    if (isBotAdmin) {
                        await sock.sendMessage(from, { delete: msg.key });
                    } else {
                        await sock.sendMessage(from, { text: `⚠️ *Anti-Link Aktif*, tetapi Bot bukan Admin sehingga tidak bisa menghapus pesan.` });
                    }
                    return; 
                }
            }
        } catch (err) {
            logError(`Anti-Link Error: ${err.message}`);
        }
    }
    // --- ANTI-LINK SYSTEM END ---

    // Determine prefix (handle standard prefixes)
    let prefixMatch = body.match(/^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/gi);
    
    // Special handling for eval command '>'
    if (body.startsWith('>')) {
        prefixMatch = ['>'];
    }

    const prefix = prefixMatch ? prefixMatch[0] : '.';
    const isCmd = body.startsWith(prefix);

    let command = isCmd ? body.slice(prefix.length).trim().split(' ')[0].toLowerCase() : '';
    let args = body.trim().split(/ +/).slice(1);
    let text = args.join(' ');

    // Special logic for Eval: treat everything after > as text, ignoring space separation issues
    if (prefix === '>') {
        command = 'eval';
        text = body.slice(1).trim();
        args = text.split(' ');
    }
    
    // Log incoming message
    logInfo(`[MSG] From: ${pushName} (${sender}) | Text: ${body.length > 20 ? body.substring(0, 20) + '...' : body}`);

    // If it is a command, try to execute plugin
    if (isCmd) {
        const plugin = getPlugin(command);
        
        if (plugin) {
            try {
                // ANTI-BAN: Humanization Logic
                if (config.antiBan?.typing) {
                    // 1. Send 'composing' presence to simulate typing
                    await sock.sendPresenceUpdate('composing', from);
                    
                    // 2. Calculate dynamic delay
                    // Base delay from config + small random variation
                    const delay = randomDelay(config.antiBan.minDelay, config.antiBan.maxDelay);
                    await sleep(delay);
                }

                // Execute Plugin with Retry Logic (Try 3 times if error occurs)
                await withRetry(async () => {
                    await plugin.run(sock, m, {
                        args,
                        text,
                        from,
                        pushName,
                        command,
                        prefix,
                        isGroup,
                        config,
                        sender // Pass computed sender to plugins for correct ID validation
                    });
                }, 3, 1000);

                await addChatHistory(from, 'system', `Executed: ${command}`, pushName);
            } catch (error) {
                logError(`Command Error (${command}): ${error.message}`);
                await sock.sendMessage(from, { text: `❌ Error executing command: ${error.message}` }, { quoted: msg });
            }
        }
    } else {
        // Log non-command messages to history for context/AI, but without delay
        await addChatHistory(from, 'user', body, pushName);
    }
}

module.exports = { handleMessage };