// @path lib/firebase.js
// @type write
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { logError, logSuccess, logInfo } = require('./logger');

let db;

try {
    let serviceAccount;

    // 1. Cek Environment Variable (Prioritas Utama)
    if (process.env.FIREBASE_KEY_JSON) {
        try {
            // Parsing string JSON dari env variable
            // Menghapus whitespace di awal/akhir untuk keamanan
            const rawJson = process.env.FIREBASE_KEY_JSON.trim();
            serviceAccount = JSON.parse(rawJson);
            logInfo('Menggunakan kredensial Firebase dari Environment Variable.');
        } catch (parseError) {
            throw new Error(`Gagal parsing process.env.FIREBASE_KEY_JSON: ${parseError.message}`);
        }
    } 
    // 2. Cek File Lokal (Fallback untuk development lokal)
    else {
        const keyPath = path.join(__dirname, '..', 'firebase-key.json');
        
        if (fs.existsSync(keyPath)) {
            serviceAccount = require(keyPath);
            logInfo('Menggunakan kredensial Firebase dari file firebase-key.json.');
        } else {
            throw new Error("Kredensial tidak ditemukan! Harap set environment variable 'FIREBASE_KEY_JSON' atau letakkan file 'firebase-key.json' di root.");
        }
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();
    // Setting agar ignore undefined properties (kompatibilitas)
    db.settings({ ignoreUndefinedProperties: true });

    logSuccess('Firebase Admin SDK initialized successfully.');
} catch (error) {
    logError(`Firebase Initialization Failed: ${error.message}`);
    process.exit(1);
}

module.exports = { db };
