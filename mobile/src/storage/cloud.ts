import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LocalDatabase } from './schema';
import { loadLocalDb, saveLocalDb } from './store';

const AUTH_KEY = 'studybuddy.auth.v1';
const CLOUD_BACKUP_KEY = 'studybuddy.cloud.backup.v1';
const LOCAL_ACCOUNTS_KEY = 'studybuddy.local.accounts.v1';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  photoUrl?: string;
  provider: 'google' | 'email';
  /** Access token for Drive API when real Google OAuth is configured. */
  accessToken?: string;
  /** Demo sessions work without Google Cloud credentials. */
  isDemo: boolean;
};

/** @deprecated Use AuthUser */
export type GoogleUser = AuthUser;

export type AuthSession = {
  user: AuthUser;
  signedInAt: string;
  lastSyncedAt: string | null;
  skippedLogin: boolean;
};

export type CloudActionResult = {
  ok: boolean;
  message: string;
  lastSyncedAt?: string | null;
};

type PersistedAuth = {
  session: AuthSession | null;
  skippedLogin: boolean;
};

type LocalAccountRecord = {
  id: string;
  email: string;
  name: string;
  /** Local-only demo credential store — not a production auth system. */
  password: string;
};

type LocalAccountMap = Record<string, LocalAccountRecord>;

async function loadLocalAccounts(): Promise<LocalAccountMap> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_ACCOUNTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LocalAccountMap;
  } catch {
    return {};
  }
}

async function saveLocalAccounts(map: LocalAccountMap): Promise<void> {
  await AsyncStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(map));
}

export async function createLocalAccount(input: {
  name: string;
  email: string;
  password: string;
}): Promise<CloudActionResult & { user?: AuthUser }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const password = input.password;

  if (!name || !email || !password) {
    return { ok: false, message: 'Please complete all fields.' };
  }
  if (!email.includes('@')) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }
  if (password.length < 8) {
    return { ok: false, message: 'Password must contain at least 8 characters.' };
  }

  const accounts = await loadLocalAccounts();
  if (accounts[email]) {
    return { ok: false, message: 'An account with this email already exists. Sign in instead.' };
  }

  const record: LocalAccountRecord = {
    id: `email-${Date.now()}`,
    email,
    name,
    password,
  };
  accounts[email] = record;
  await saveLocalAccounts(accounts);

  return {
    ok: true,
    message: `Welcome, ${name}! Your account is ready.`,
    user: {
      id: record.id,
      email: record.email,
      name: record.name,
      provider: 'email',
      isDemo: true,
    },
  };
}

export async function signInLocalAccount(input: {
  email: string;
  password: string;
}): Promise<CloudActionResult & { user?: AuthUser }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    return { ok: false, message: 'Please enter your email and password.' };
  }

  const accounts = await loadLocalAccounts();
  const record = accounts[email];
  if (!record || record.password !== password) {
    return { ok: false, message: 'Incorrect email or password.' };
  }

  return {
    ok: true,
    message: 'Signed in successfully.',
    user: {
      id: record.id,
      email: record.email,
      name: record.name,
      provider: 'email',
      isDemo: true,
    },
  };
}

export async function loadAuthState(): Promise<PersistedAuth> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_KEY);
    if (!raw) return { session: null, skippedLogin: false };
    const parsed = JSON.parse(raw) as PersistedAuth;
    return {
      session: parsed.session ?? null,
      skippedLogin: Boolean(parsed.skippedLogin),
    };
  } catch {
    return { session: null, skippedLogin: false };
  }
}

export async function saveAuthState(state: PersistedAuth): Promise<void> {
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(state));
}

export async function clearAuthState(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY);
}

function googleClientId(): string | undefined {
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || undefined;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(googleClientId());
}

export function getGoogleWebClientId(): string | undefined {
  return googleClientId();
}

/**
 * Backup local DB into Google Drive App Data when a real token exists;
 * otherwise keep a private on-device cloud mirror keyed by Google account.
 */
export async function backupLocalData(user: AuthUser): Promise<CloudActionResult> {
  const db = await loadLocalDb();
  const stamped = {
    ...db,
    settings: { ...db.settings, cloud_sync_enabled: true },
  };
  const now = new Date().toISOString();

  if (user.accessToken && !user.isDemo) {
    try {
      await uploadToGoogleDriveAppData(user.accessToken, stamped);
      return {
        ok: true,
        message: 'Backup saved to your Google Drive (App Data).',
        lastSyncedAt: now,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Drive upload failed';
      return { ok: false, message: detail };
    }
  }

  // Local mirror for demo / Expo Go without Google Cloud credentials.
  const mirrors = await loadLocalMirrors();
  mirrors[user.id] = { updatedAt: now, database: stamped };
  await AsyncStorage.setItem(CLOUD_BACKUP_KEY, JSON.stringify(mirrors));

  return {
    ok: true,
    message: user.isDemo
      ? 'Demo backup saved for this Google account on this device.'
      : 'Backup saved for your Google account on this device.',
    lastSyncedAt: now,
  };
}

export async function restoreLocalData(user: AuthUser): Promise<CloudActionResult> {
  const now = new Date().toISOString();

  if (user.accessToken && !user.isDemo) {
    try {
      const remote = await downloadFromGoogleDriveAppData(user.accessToken);
      if (!remote) {
        return {
          ok: false,
          message: 'No Google Drive backup found yet. Create one with Backup now.',
        };
      }
      await saveLocalDb(remote);
      return {
        ok: true,
        message: 'Restored study data from Google Drive.',
        lastSyncedAt: now,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Drive restore failed';
      return { ok: false, message: detail };
    }
  }

  const mirrors = await loadLocalMirrors();
  const mirror = mirrors[user.id];
  if (!mirror) {
    return {
      ok: false,
      message: 'No backup found for this account yet. Tap Backup now first.',
    };
  }
  await saveLocalDb(mirror.database);
  return {
    ok: true,
    message: 'Restored study data from your Google backup.',
    lastSyncedAt: mirror.updatedAt,
  };
}

type MirrorMap = Record<string, { updatedAt: string; database: LocalDatabase }>;

async function loadLocalMirrors(): Promise<MirrorMap> {
  try {
    const raw = await AsyncStorage.getItem(CLOUD_BACKUP_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as MirrorMap;
  } catch {
    return {};
  }
}

const BACKUP_FILENAME = 'studybuddy-backup.json';

async function uploadToGoogleDriveAppData(
  accessToken: string,
  database: LocalDatabase,
): Promise<void> {
  const existingId = await findDriveBackupFileId(accessToken);
  const metadata = {
    name: BACKUP_FILENAME,
    parents: ['appDataFolder'],
  };
  const boundary = `studybuddy_${Date.now()}`;
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${JSON.stringify(database)}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  const response = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function downloadFromGoogleDriveAppData(
  accessToken: string,
): Promise<LocalDatabase | null> {
  const fileId = await findDriveBackupFileId(accessToken);
  if (!fileId) return null;

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as LocalDatabase;
}

async function findDriveBackupFileId(accessToken: string): Promise<string | null> {
  const query = encodeURIComponent(`name='${BACKUP_FILENAME}'`);
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = (await response.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}
