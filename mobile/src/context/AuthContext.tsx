import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

import {
  backupLocalData,
  clearAuthState,
  createLocalAccount,
  getGoogleOAuthConfig,
  getGoogleSignInSetupHint,
  isGoogleOAuthConfigured,
  isNativeGoogleSignInAvailable,
  loadAuthState,
  restoreLocalData,
  saveAuthState,
  signInLocalAccount,
  type AuthSession,
  type AuthUser,
  type CloudActionResult,
} from '../storage/cloud';
import { clearChatSession } from '../api/chatApi';
import {
  GOOGLE_DRIVE_APPDATA_SCOPE,
  syncDownFromGoogleDrive,
  syncUpToGoogleDrive,
} from '../storage/googleDriveSync';
import {
  GUEST_STORAGE_SCOPE,
  setActiveStorageScope,
} from '../storage/store';

const GOOGLE_SIGNIN_SCOPES = [
  'openid',
  'profile',
  'email',
  GOOGLE_DRIVE_APPDATA_SCOPE,
];

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

function loadGoogleSignInModule(): GoogleSignInModule | null {
  if (!isNativeGoogleSignInAvailable()) return null;
  try {
    // Dynamic require so Expo Go never loads the TurboModule.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  } catch {
    return null;
  }
}

type AuthContextValue = {
  ready: boolean;
  session: AuthSession | null;
  skippedLogin: boolean;
  isSignedIn: boolean;
  googleConfigured: boolean;
  googleSetupHint: string;
  signInWithGoogle: (profile?: {
    name?: string;
    email?: string;
  }) => Promise<CloudActionResult>;
  signInWithEmail: (email: string, password: string) => Promise<CloudActionResult>;
  createAccount: (
    name: string,
    email: string,
    password: string,
  ) => Promise<CloudActionResult>;
  skipLogin: () => Promise<void>;
  signOut: () => Promise<void>;
  backupNow: () => Promise<CloudActionResult>;
  restoreNow: () => Promise<CloudActionResult>;
  /** Upload this account's local data to Google Drive app data. */
  syncUpToGoogle: () => Promise<CloudActionResult>;
  /** Download Google Drive app data into this account's local storage. */
  syncDownFromGoogle: () => Promise<CloudActionResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'SB';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function useAuthSession() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [skippedLogin, setSkippedLogin] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const state = await loadAuthState();
        if (!alive) return;
        const scope = state.session?.user.id ?? GUEST_STORAGE_SCOPE;
        await setActiveStorageScope(scope);
        if (!alive) return;
        setSession(state.session);
        setSkippedLogin(state.skippedLogin);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(async (next: {
    session: AuthSession | null;
    skippedLogin: boolean;
  }) => {
    setSession(next.session);
    setSkippedLogin(next.skippedLogin);
    await saveAuthState(next);
  }, []);

  const finishSignIn = useCallback(
    async (user: AuthUser): Promise<CloudActionResult> => {
      await setActiveStorageScope(user.id);
      const nextSession: AuthSession = {
        user,
        signedInAt: new Date().toISOString(),
        lastSyncedAt: null,
        skippedLogin: false,
      };
      await persist({ session: nextSession, skippedLogin: false });
      return {
        ok: true,
        message: `Welcome, ${user.name}! You're signed in.`,
      };
    },
    [persist],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        const result = await signInLocalAccount({ email, password });
        if (!result.ok || !result.user) return result;
        return finishSignIn(result.user);
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : 'Could not sign in. Please try again.',
        };
      }
    },
    [finishSignIn],
  );

  const createAccount = useCallback(
    async (name: string, email: string, password: string) => {
      try {
        const result = await createLocalAccount({ name, email, password });
        if (!result.ok || !result.user) return result;
        return finishSignIn(result.user);
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : 'Could not create account. Please try again.',
        };
      }
    },
    [finishSignIn],
  );

  const signInWithDemoGoogle = useCallback(
    async (profile?: { name?: string; email?: string }) => {
      const name = profile?.name?.trim() || 'Study Buddy Student';
      const email = (profile?.email?.trim() || 'student@gmail.com').toLowerCase();
      const user: AuthUser = {
        id: `google-demo-${email}`,
        email,
        name,
        provider: 'google',
        isDemo: true,
      };
      return finishSignIn(user);
    },
    [finishSignIn],
  );

  const skipLogin = useCallback(async () => {
    await setActiveStorageScope(GUEST_STORAGE_SCOPE);
    await persist({ session: null, skippedLogin: true });
  }, [persist]);

  const signOutNativeGoogle = useCallback(async () => {
    const mod = loadGoogleSignInModule();
    if (!mod) return;
    try {
      await mod.GoogleSignin.signOut();
    } catch {
      // Ignore native sign-out failures; local session is still cleared.
    }
  }, []);

  const signOut = useCallback(async () => {
    await signOutNativeGoogle();
    await clearChatSession();
    await clearAuthState();
    await setActiveStorageScope(GUEST_STORAGE_SCOPE);
    await persist({ session: null, skippedLogin: false });
  }, [persist, signOutNativeGoogle]);

  const backupNow = useCallback(async () => {
    if (!session?.user) {
      return { ok: false, message: 'Sign in to export flashcard PDFs.' };
    }
    try {
      const result = await backupLocalData(session.user);
      if (result.ok) {
        const synced: AuthSession = {
          ...session,
          lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
        };
        await persist({ session: synced, skippedLogin: false });
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Backup failed.',
      };
    }
  }, [persist, session]);

  const restoreNow = useCallback(async () => {
    if (!session?.user) {
      return { ok: false, message: 'Sign in to restore from PDF backups.' };
    }
    try {
      const result = await restoreLocalData(session.user);
      if (result.ok) {
        const synced: AuthSession = {
          ...session,
          lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
        };
        await persist({ session: synced, skippedLogin: false });
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Restore failed.',
      };
    }
  }, [persist, session]);

  const googleSyncUnavailable = useCallback(async (): Promise<CloudActionResult> => {
    if (!session?.user) {
      return { ok: false, message: 'Sign in with Google to sync.' };
    }
    if (session.user.provider !== 'google' || session.user.isDemo) {
      return {
        ok: false,
        message:
          'Google Drive sync needs a real Google sign-in (not email or demo Google).',
      };
    }
    return {
      ok: false,
      message: 'Google Drive sync is unavailable in this build.',
    };
  }, [session]);

  return {
    ready,
    session,
    skippedLogin,
    persist,
    finishSignIn,
    signInWithEmail,
    createAccount,
    signInWithDemoGoogle,
    skipLogin,
    signOut,
    backupNow,
    restoreNow,
    googleSyncUnavailable,
  };
}

/** Local email/password + demo Google (no native Google Sign-In). */
function LocalAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();
  const googleSetupHint = getGoogleSignInSetupHint();

  const value = useMemo<AuthContextValue>(
    () => ({
      ready: auth.ready,
      session: auth.session,
      skippedLogin: auth.skippedLogin,
      isSignedIn: Boolean(auth.session?.user),
      googleConfigured: false,
      googleSetupHint,
      signInWithGoogle: auth.signInWithDemoGoogle,
      signInWithEmail: auth.signInWithEmail,
      createAccount: auth.createAccount,
      skipLogin: auth.skipLogin,
      signOut: auth.signOut,
      backupNow: auth.backupNow,
      restoreNow: auth.restoreNow,
      syncUpToGoogle: auth.googleSyncUnavailable,
      syncDownFromGoogle: auth.googleSyncUnavailable,
    }),
    [
      auth.ready,
      auth.session,
      auth.skippedLogin,
      auth.signInWithDemoGoogle,
      auth.signInWithEmail,
      auth.createAccount,
      auth.skipLogin,
      auth.signOut,
      auth.backupNow,
      auth.restoreNow,
      auth.googleSyncUnavailable,
      googleSetupHint,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Native Google Sign-In (Play Services / Google SDK).
 * Avoids browser OAuth custom-scheme redirects that Google blocks with
 * Error 400: invalid_request / OAuth 2.0 policy.
 */
function GoogleAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();
  const oauth = getGoogleOAuthConfig()!;
  const googleMod = useMemo(() => loadGoogleSignInModule(), []);

  useEffect(() => {
    if (!googleMod) return;
    googleMod.GoogleSignin.configure({
      webClientId: oauth.webClientId,
      iosClientId: oauth.iosClientId,
      offlineAccess: false,
      scopes: GOOGLE_SIGNIN_SCOPES,
    });
  }, [googleMod, oauth.iosClientId, oauth.webClientId]);

  const ensureDriveAccessToken = useCallback(async (): Promise<
    CloudActionResult & { accessToken?: string }
  > => {
    if (!googleMod) {
      return {
        ok: false,
        message: 'Google Sign-In is unavailable in this build.',
      };
    }
    if (!auth.session?.user || auth.session.user.provider !== 'google') {
      return { ok: false, message: 'Sign in with Google to sync with Drive.' };
    }
    if (auth.session.user.isDemo) {
      return {
        ok: false,
        message: 'Google Drive sync needs a real Google account, not the demo session.',
      };
    }

    try {
      try {
        await googleMod.GoogleSignin.addScopes({
          scopes: [GOOGLE_DRIVE_APPDATA_SCOPE],
        });
      } catch {
        // Scope may already be granted.
      }
      const tokens = await googleMod.GoogleSignin.getTokens();
      if (!tokens.accessToken) {
        return {
          ok: false,
          message: 'Could not get a Google access token. Sign out and sign in again.',
        };
      }
      if (tokens.accessToken !== auth.session.user.accessToken) {
        await auth.persist({
          session: {
            ...auth.session,
            user: { ...auth.session.user, accessToken: tokens.accessToken },
          },
          skippedLogin: false,
        });
      }
      return { ok: true, message: 'ok', accessToken: tokens.accessToken };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Could not authorize Google Drive. Try signing in again.',
      };
    }
  }, [auth, googleMod]);

  const syncUpToGoogle = useCallback(async () => {
    const tokenResult = await ensureDriveAccessToken();
    if (!tokenResult.ok || !tokenResult.accessToken || !auth.session?.user) {
      return {
        ok: false,
        message: tokenResult.message || 'Google Drive authorization failed.',
      };
    }
    const result = await syncUpToGoogleDrive(
      auth.session.user,
      tokenResult.accessToken,
    );
    if (result.ok) {
      await auth.persist({
        session: {
          ...auth.session,
          lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
        },
        skippedLogin: false,
      });
    }
    return result;
  }, [auth, ensureDriveAccessToken]);

  const syncDownFromGoogle = useCallback(async () => {
    const tokenResult = await ensureDriveAccessToken();
    if (!tokenResult.ok || !tokenResult.accessToken || !auth.session?.user) {
      return {
        ok: false,
        message: tokenResult.message || 'Google Drive authorization failed.',
      };
    }
    const result = await syncDownFromGoogleDrive(
      auth.session.user,
      tokenResult.accessToken,
    );
    if (result.ok) {
      await auth.persist({
        session: {
          ...auth.session,
          lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
        },
        skippedLogin: false,
      });
    }
    return result;
  }, [auth, ensureDriveAccessToken]);

  const signInWithGoogle = useCallback(async () => {
    try {
      if (!googleMod) {
        return {
          ok: false,
          message:
            'Google Sign-In is unavailable in this build. Use a development or preview build, or sign in with email.',
        };
      }

      if (Platform.OS === 'android') {
        await googleMod.GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
      }

      const response = await googleMod.GoogleSignin.signIn();
      if (response.type === 'cancelled') {
        return { ok: false, message: 'Google sign-in was cancelled.' };
      }
      if (response.type !== 'success' || !response.data?.user) {
        return {
          ok: false,
          message:
            'Google sign-in failed. Confirm the Android OAuth client uses package com.studybuddy.ai and your signing SHA-1.',
        };
      }

      const profile = response.data.user;
      let accessToken: string | undefined;
      try {
        const tokens = await googleMod.GoogleSignin.getTokens();
        accessToken = tokens.accessToken;
      } catch {
        accessToken = undefined;
      }

      return auth.finishSignIn({
        id: profile.id,
        email: profile.email,
        name: profile.name || profile.email.split('@')[0] || 'Student',
        photoUrl: profile.photo ?? undefined,
        accessToken,
        provider: 'google',
        isDemo: false,
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      const rawMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : '';
      if (code === googleMod?.statusCodes.IN_PROGRESS) {
        return { ok: false, message: 'Google sign-in is already in progress.' };
      }
      if (code === googleMod?.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return {
          ok: false,
          message: 'Google Play Services is required for Google sign-in.',
        };
      }
      // Android status 10 / DEVELOPER_ERROR = package name or SHA-1 mismatch
      // in Google Cloud Console (or webClientId is not a Web client ID).
      if (
        code === '10' ||
        /DEVELOPER_ERROR/i.test(rawMessage) ||
        /Developer console is not set up correctly/i.test(rawMessage)
      ) {
        return {
          ok: false,
          message:
            'Google Cloud setup needed: add an Android OAuth client for package com.studybuddy.ai with this app’s signing SHA-1 (see README / npm run apk:sha1). Also use a Web client ID in EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID — not the Android client ID.',
        };
      }
      return {
        ok: false,
        message: rawMessage || 'Could not sign in with Google. Please try again.',
      };
    }
  }, [auth, googleMod]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready: auth.ready,
      session: auth.session,
      skippedLogin: auth.skippedLogin,
      isSignedIn: Boolean(auth.session?.user),
      googleConfigured: true,
      googleSetupHint: '',
      signInWithGoogle,
      signInWithEmail: auth.signInWithEmail,
      createAccount: auth.createAccount,
      skipLogin: auth.skipLogin,
      signOut: auth.signOut,
      backupNow: auth.backupNow,
      restoreNow: auth.restoreNow,
      syncUpToGoogle,
      syncDownFromGoogle,
    }),
    [
      auth.ready,
      auth.session,
      auth.skippedLogin,
      auth.signInWithEmail,
      auth.createAccount,
      auth.skipLogin,
      auth.signOut,
      auth.backupNow,
      auth.restoreNow,
      signInWithGoogle,
      syncUpToGoogle,
      syncDownFromGoogle,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (isGoogleOAuthConfigured()) {
    return <GoogleAuthProvider>{children}</GoogleAuthProvider>;
  }
  return <LocalAuthProvider>{children}</LocalAuthProvider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useAuthInitials(): string {
  const { session } = useAuth();
  if (!session?.user) return 'SB';
  return initialsFromName(session.user.name);
}
