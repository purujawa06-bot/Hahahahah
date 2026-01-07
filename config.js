/**
 * Configuration file for Plugin Bot.
 */
module.exports = {
    sessionName: "auth_info_baileys",
    botName: "Alicia BOT",
    ownerName: "PuruBoy",
    ownerNumber: "6283894391287", // Change this to your number
    ownerLid: "92776125477117@lid", // Tambahan untuk akses via LID (Companion/Secondary Device)
    footer: "© NextA Project 2025",
    apiBaseUrl: "https://www.puruboy.kozow.com", // Base domain API
    
    // Feature Settings
    autoRead: true, // Automatically mark messages as read (Blue ticks)

    // Anti-Ban & Performance Settings
    antiBan: {
        typing: true, // Auto send 'composing' presence
        minDelay: 1000, // Minimum delay in ms before replying
        maxDelay: 3000, // Maximum delay in ms
    }
};