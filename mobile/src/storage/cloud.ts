import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  exportFlashcardsAsPdfs,
  restoreFlashcardsFromPdfs,
} from './pdfBackup';

const AUTH_KEY = 'studybuddy.auth.v1';
const LOCAL_ACCOUNTS_KEY = 'studybuddy.local.accounts.v1';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  photoUrl?: string;
  provider: 'google' | 'email';
  accessToken?: string;
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'Please enter a valid email address.' };
  }
  if (password.length < 8) {
    return { ok: false, message: 'Password must contain at least 8 characters.' };
  }

  const accounts = await loadLocalAccounts();
  if (accounts[email]) {
    return {
      ok: false,
      message: 'An account with this email already exists. Sign in instead.',
    };
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
    message: `Welcome back, ${record.name}!`,
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

/** Backup: export each subject folder as a PDF (shared as a zip). */
export async function backupLocalData(
  _user?: AuthUser,
): Promise<CloudActionResult> {
  return exportFlashcardsAsPdfs();
}

/** Restore: pick PDF file(s) and regenerate flashcards with Gemini. */
export async function restoreLocalData(
  _user?: AuthUser,
): Promise<CloudActionResult> {
  return restoreFlashcardsFromPdfs();
}

type GoogleExtra = {
  googleWebClientId?: string;
  googleIosClientId?: string;
  googleAndroidClientId?: string;
};

function readGoogleExtra(): GoogleExtra {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as {
      expoConfig?: { extra?: GoogleExtra };
    };
    return Constants.expoConfig?.extra ?? {};
  } catch {
    return {};
  }
}

export type GoogleOAuthConfig = {
  webClientId: string;
  iosClientId?: string;
  androidClientId?: string;
};

/** True when running inside Expo Go (no custom native modules). */
export function isExpoGoRuntime(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants') as {
      default: { executionEnvironment?: string };
      ExecutionEnvironment?: { StoreClient: string };
    };
    const storeClient =
      Constants.ExecutionEnvironment?.StoreClient ?? 'storeClient';
    return Constants.default.executionEnvironment === storeClient;
  } catch {
    return false;
  }
}

/**
 * Native Google Sign-In is available in development / production builds that
 * include `@react-native-google-signin/google-signin`. Expo Go cannot load it.
 */
export function isNativeGoogleSignInAvailable(): boolean {
  if (isExpoGoRuntime()) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TurboModuleRegistry } = require('react-native') as {
      TurboModuleRegistry: {
        get: (name: string) => object | null;
      };
    };
    return TurboModuleRegistry.get('RNGoogleSignin') != null;
  } catch {
    return false;
  }
}

/** Builds the iOS reversed-client-id URL scheme for the config plugin. */
export function iosUrlSchemeFromClientId(iosClientId: string): string | null {
  const id = iosClientId.trim();
  const suffix = '.apps.googleusercontent.com';
  if (!id.endsWith(suffix)) return null;
  const prefix = id.slice(0, -suffix.length);
  if (!prefix) return null;
  return `com.googleusercontent.apps.${prefix}`;
}

/** Reads Google OAuth client IDs from Expo config / EXPO_PUBLIC_* env. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const extra = readGoogleExtra();
  const webClientId = (
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    extra.googleWebClientId ||
    ''
  ).trim();
  if (!webClientId) return null;

  const iosClientId = (
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
    extra.googleIosClientId ||
    ''
  ).trim();

  const androidClientId = (
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    extra.googleAndroidClientId ||
    ''
  ).trim();

  return {
    webClientId,
    iosClientId: iosClientId || undefined,
    androidClientId: androidClientId || undefined,
  };
}

/**
 * Real Google sign-in is ready when a Web client ID is set and the native
 * Google Sign-In module is present (dev client / EAS build — not Expo Go).
 */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getGoogleOAuthConfig()?.webClientId) && isNativeGoogleSignInAvailable();
}

/** Short hint for the login screen when real Google sign-in cannot run. */
export function getGoogleSignInSetupHint(): string {
  if (isExpoGoRuntime()) {
    return 'Google Sign-In needs a development or preview build (not Expo Go). Email signup still works here.';
  }
  if (!getGoogleOAuthConfig()?.webClientId) {
    return 'Continues with a Google-style session on this device. Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and rebuild for real Google sign-in.';
  }
  if (!isNativeGoogleSignInAvailable()) {
    return 'Google Sign-In native module missing. Rebuild the app with EAS after installing dependencies.';
  }
  return 'Continues with a Google-style session on this device.';
}

export function getGoogleWebClientId(): string | undefined {
  return getGoogleOAuthConfig()?.webClientId;
}
