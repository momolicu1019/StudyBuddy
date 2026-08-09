import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

import {
  backupLocalData,
  clearAuthState,
  createLocalAccount,
  getGoogleWebClientId,
  isGoogleOAuthConfigured,
  loadAuthState,
  restoreLocalData,
  saveAuthState,
  signInLocalAccount,
  type AuthSession,
  type AuthUser,
  type CloudActionResult,
} from '../storage/cloud';

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  ready: boolean;
  session: AuthSession | null;
  skippedLogin: boolean;
  isSignedIn: boolean;
  googleConfigured: boolean;
  signInWithGoogle: () => Promise<CloudActionResult>;
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
    async (
      user: AuthUser,
      options?: { autoBackup?: boolean },
    ): Promise<CloudActionResult> => {
      const nextSession: AuthSession = {
        user,
        signedInAt: new Date().toISOString(),
        lastSyncedAt: null,
        skippedLogin: false,
      };

      // Persist session first so navigation can leave the login screen immediately.
      await persist({ session: nextSession, skippedLogin: false });

      if (options?.autoBackup === false) {
        return {
          ok: true,
          message: `Welcome, ${user.name}! You're signed in.`,
        };
      }

      try {
        const backup = await backupLocalData(user);
        if (backup.ok) {
          const synced: AuthSession = {
            ...nextSession,
            lastSyncedAt: backup.lastSyncedAt ?? new Date().toISOString(),
          };
          await persist({ session: synced, skippedLogin: false });
          return {
            ok: true,
            message: `Signed in as ${user.email}. ${backup.message}`,
            lastSyncedAt: backup.lastSyncedAt ?? null,
          };
        }
      } catch {
        // Backup is optional — account sign-in should still succeed.
      }

      return {
        ok: true,
        message: `Signed in as ${user.email}.`,
      };
    },
    [persist],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        const result = await signInLocalAccount({ email, password });
        if (!result.ok || !result.user) return result;
        return finishSignIn(result.user, { autoBackup: false });
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
        return finishSignIn(result.user, { autoBackup: false });
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

  const signInWithDemoGoogle = useCallback(async () => {
    const user: AuthUser = {
      id: 'demo-google-user',
      email: 'student@gmail.com',
      name: 'Study Buddy Student',
      provider: 'google',
      isDemo: true,
    };
    return finishSignIn(user, { autoBackup: true });
  }, [finishSignIn]);

  const skipLogin = useCallback(async () => {
    await persist({ session: null, skippedLogin: true });
  }, [persist]);

  const signOut = useCallback(async () => {
    await clearAuthState();
    // Return to login instead of skipping forever.
    await persist({ session: null, skippedLogin: false });
  }, [persist]);

  const backupNow = useCallback(async () => {
    if (!session?.user) {
      return { ok: false, message: 'Sign in to back up your data.' };
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
      return { ok: false, message: 'Sign in to restore a backup.' };
    }
    try {
      return await restoreLocalData(session.user);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Restore failed.',
      };
    }
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
  };
}

/** Local email/password + demo Google (no OAuth client ID required). */
function LocalAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();

  const value = useMemo<AuthContextValue>(
    () => ({
      ready: auth.ready,
      session: auth.session,
      skippedLogin: auth.skippedLogin,
      isSignedIn: Boolean(auth.session?.user),
      googleConfigured: false,
      signInWithGoogle: auth.signInWithDemoGoogle,
      signInWithEmail: auth.signInWithEmail,
      createAccount: auth.createAccount,
      skipLogin: auth.skipLogin,
      signOut: auth.signOut,
      backupNow: auth.backupNow,
      restoreNow: auth.restoreNow,
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
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Real Google OAuth when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is set. */
function GoogleAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();
  const webClientId = getGoogleWebClientId()!;

  const [request, , promptAsync] = Google.useAuthRequest({
    webClientId,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || webClientId,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || webClientId,
    scopes: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
  });

  const signInWithGoogle = useCallback(async () => {
    try {
      if (!request) {
        return {
          ok: false,
          message: 'Google sign-in is still preparing. Please try again in a moment.',
        };
      }

      const result = await promptAsync();
      if (result.type !== 'success') {
        return { ok: false, message: 'Google sign-in was cancelled.' };
      }

      const accessToken = result.authentication?.accessToken;
      if (!accessToken) {
        return { ok: false, message: 'Google did not return an access token.' };
      }

      const profileRes = await fetch('https://www.googleapis.com/userinfo/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileRes.ok) {
        return { ok: false, message: 'Could not load your Google profile.' };
      }

      const profile = (await profileRes.json()) as {
        id: string;
        email: string;
        name: string;
        picture?: string;
      };

      return auth.finishSignIn({
        id: profile.id,
        email: profile.email,
        name: profile.name || profile.email,
        photoUrl: profile.picture,
        accessToken,
        provider: 'google',
        isDemo: false,
      });
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Could not sign in with Google. Please try again.',
      };
    }
  }, [auth, promptAsync, request]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready: auth.ready,
      session: auth.session,
      skippedLogin: auth.skippedLogin,
      isSignedIn: Boolean(auth.session?.user),
      googleConfigured: true,
      signInWithGoogle,
      signInWithEmail: auth.signInWithEmail,
      createAccount: auth.createAccount,
      skipLogin: auth.skipLogin,
      signOut: auth.signOut,
      backupNow: auth.backupNow,
      restoreNow: auth.restoreNow,
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
