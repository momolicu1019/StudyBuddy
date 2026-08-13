/**
 * Firebase app bootstrap for student chat (Auth + Firestore).
 * Uses the Firebase JS SDK so it works in Expo without native modules.
 */

import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
} from 'firebase/firestore';

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

function readConfig(): FirebaseWebConfig | null {
  const apiKey = (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim();
  const authDomain = (process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim();
  const projectId = (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const storageBucket = (
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || ''
  ).trim();
  const messagingSenderId = (
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || ''
  ).trim();
  const appId = (process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '').trim();

  if (!apiKey || !authDomain || !projectId || !appId) return null;

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

export function isFirebaseConfigured(): boolean {
  return Boolean(readConfig());
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  const config = readConfig();
  if (!config) {
    throw new Error(
      'Firebase is not configured. Add EXPO_PUBLIC_FIREBASE_* values to mobile/.env',
    );
  }
  app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  return auth;
}

export function getFirestoreDb(): Firestore {
  if (db) return db;
  // React Native / Expo often cannot keep the default WebChannel stream alive,
  // so live listeners only refresh on the next explicit fetch (e.g. opening a
  // chat). Force long-polling so message + conversation snapshots sync live.
  try {
    db = initializeFirestore(getFirebaseApp(), {
      experimentalForceLongPolling: true,
      localCache: memoryLocalCache(),
    });
  } catch {
    // Fast refresh / remount may already have initialized Firestore.
    db = getFirestore(getFirebaseApp());
  }
  return db;
}
