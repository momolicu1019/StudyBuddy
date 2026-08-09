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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [skippedLogin, setSkippedLogin] = useState(false);
  const webClientId =
    getGoogleWebClientId() ?? '000000000000-demo.apps.googleusercontent.com';
  const googleConfigured = isGoogleOAuthConfigured();

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

  useEffect(() => {
    (async () => {
      const state = await loadAuthState();
      setSession(state.session);
      setSkippedLogin(state.skippedLogin);
      setReady(true);
    })();
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
    async (user: AuthUser, options?: { autoBackup?: boolean }): Promise<CloudActionResult> => {
      const nextSession: AuthSession = {
        user,
        signedInAt: new Date().toISOString(),
        lastSyncedAt: null,
        skippedLogin: false,
      };
      await persist({ session: nextSession, skippedLogin: false });

      if (options?.autoBackup === false) {
        return { ok: true, message: `Signed in as ${user.email}.` };
      }

      const backup = await backupLocalData(user);
      if (backup.ok) {
        const synced: AuthSession = {
          ...nextSession,
          lastSyncedAt: backup.lastSyncedAt ?? new Date().toISOString(),
        };
        await persist({ session: synced, skippedLogin: false });
      }

      return {
        ok: true,
        message: backup.ok
          ? `Signed in as ${user.email}. ${backup.message}`
          : `Signed in as ${user.email}.`,
        lastSyncedAt: backup.lastSyncedAt ?? null,
      };
    },
    [persist],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const result = await signInLocalAccount({ email, password });
      if (!result.ok || !result.user) return result;
      return finishSignIn(result.user, { autoBackup: false });
    },
    [finishSignIn],
  );

  const createAccount = useCallback(
    async (name: string, email: string, password: string) => {
      const result = await createLocalAccount({ name, email, password });
      if (!result.ok || !result.user) return result;
      return finishSignIn(result.user, { autoBackup: false });
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
    return finishSignIn(user);
  }, [finishSignIn]);

  const signInWithGoogle = useCallback(async () => {
    if (!googleConfigured || !request) {
      return signInWithDemoGoogle();
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

    return finishSignIn({
      id: profile.id,
      email: profile.email,
      name: profile.name || profile.email,
      photoUrl: profile.picture,
      accessToken,
      provider: 'google',
      isDemo: false,
    });
  }, [finishSignIn, googleConfigured, promptAsync, request, signInWithDemoGoogle]);

  const skipLogin = useCallback(async () => {
    await persist({ session: null, skippedLogin: true });
  }, [persist]);

  const signOut = useCallback(async () => {
    await clearAuthState();
    await persist({ session: null, skippedLogin: true });
  }, [persist]);

  const backupNow = useCallback(async () => {
    if (!session?.user) {
      return { ok: false, message: 'Sign in to back up your data.' };
    }
    const result = await backupLocalData(session.user);
    if (result.ok) {
      const synced: AuthSession = {
        ...session,
        lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
      };
      await persist({ session: synced, skippedLogin: false });
    }
    return result;
  }, [persist, session]);

  const restoreNow = useCallback(async () => {
    if (!session?.user) {
      return { ok: false, message: 'Sign in to restore a backup.' };
    }
    return restoreLocalData(session.user);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      skippedLogin,
      isSignedIn: Boolean(session?.user),
      googleConfigured,
      signInWithGoogle,
      signInWithEmail,
      createAccount,
      skipLogin,
      signOut,
      backupNow,
      restoreNow,
    }),
    [
      ready,
      session,
      skippedLogin,
      googleConfigured,
      signInWithGoogle,
      signInWithEmail,
      createAccount,
      skipLogin,
      signOut,
      backupNow,
      restoreNow,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
