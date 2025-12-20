const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { logError, logSuccess } = require('./logger');

let db;

try {
    const keyPath = path.join(__dirname, '..', 'firebase-key.json');
    
    if (!fs.existsSync(keyPath)) {
        throw new Error("File 'firebase-key.json' tidak ditemukan di root project. Silakan unduh Service Account Key dari Firebase Console.");
    }

    const serviceAccount = require(keyPath);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();
    // Setting agar ignore undefined properties (optional, good for compatibility)
    db.settings({ ignoreUndefinedProperties: true });

    logSuccess('Firebase Admin SDK initialized successfully.');
} catch (error) {
    logError(`Firebase Initialization Failed: ${error.message}`);
    process.exit(1);
}

module.exports = { db };