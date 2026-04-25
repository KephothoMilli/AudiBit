import * as admin from 'firebase-admin';

let _db: admin.firestore.Firestore | null = null;

export function getApp() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    return admin.app();
}

export function getDb() {
    if (!_db) {
        getApp();
        _db = admin.firestore();
    }
    return _db;
}
