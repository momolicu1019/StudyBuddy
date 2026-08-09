import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  backupLocalData,
  clearAuthState,
  createLocalAccount,
  loadAuthState,
  restoreLocalData,
  saveAuthState,
  signInLocalAccount,
  type AuthSession,
  type AuthUser,
  type CloudActionResult,
} from '../storage/cloud';

type AuthContextValue = {
  ready: boolean;
  session: AuthSession | null;
  skippedLogin: boolean;
  isSignedIn: boolean;
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
    async (user: AuthUser): Promise<CloudActionResult> => {
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

  const skipLogin = useCallback(async () => {
    await persist({ session: null, skippedLogin: true });
  }, [persist]);

  const signOut = useCallback(async () => {
    await clearAuthState();
    await persist({ session: null, skippedLogin: false });
  }, [persist]);

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

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      skippedLogin,
      isSignedIn: Boolean(session?.user),
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
