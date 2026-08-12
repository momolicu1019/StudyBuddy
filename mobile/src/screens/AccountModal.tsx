import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppModal, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth, useAuthInitials } from '../context/AuthContext';
import { colors } from '../theme/colors';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function AccountModal({ visible, onClose }: Props) {
  const { refresh, showToast } = useApp();
  const {
    session,
    isSignedIn,
    backupNow,
    restoreNow,
    syncUpToGoogle,
    syncDownFromGoogle,
    signOut,
  } = useAuth();
  const initials = useAuthInitials();
  const [busy, setBusy] = useState(false);

  const canGoogleSync =
    isSignedIn &&
    session?.user.provider === 'google' &&
    session.user.isDemo === false;

  async function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    try {
      const result = await action();
      showToast(result.message);
      if (result.ok) {
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppModal visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {isSignedIn ? session?.user.name : 'Guest'}
          </Text>
          <Text style={styles.sub}>
            {isSignedIn
              ? session?.user.email
              : 'Studying offline — sign in with Google to sync or manage PDF backups'}
          </Text>
        </View>
      </View>

      {canGoogleSync ? (
        <View style={styles.meta}>
          <Text style={styles.metaLabel}>Google Drive sync</Text>
          <Text style={styles.metaValue}>
            {session?.lastSyncedAt
              ? `Last sync ${new Date(session.lastSyncedAt).toLocaleString()}`
              : 'Keep folders & flashcards in your Google account'}
          </Text>
          <Text style={[styles.sub, { marginTop: 6 }]}>
            Sync up uploads this account’s study data to a private Drive app
            folder. Sync down replaces local data with the cloud copy.
          </Text>
          <View style={{ gap: 10, marginTop: 12 }}>
            <PrimaryButton
              label={busy ? 'Working…' : 'Sync up to Google'}
              onPress={() => void run(syncUpToGoogle)}
            />
            <PrimaryButton
              label={busy ? 'Working…' : 'Sync down from Google'}
              variant="secondary"
              onPress={() => void run(syncDownFromGoogle)}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.meta}>
        <Text style={styles.metaLabel}>PDF backup</Text>
        <Text style={styles.metaValue}>
          {isSignedIn
            ? 'Export subject folders as PDFs anytime'
            : 'Sign in to export or restore flashcard PDFs'}
        </Text>
        {isSignedIn ? (
          <Text style={[styles.sub, { marginTop: 6 }]}>
            Backup downloads one PDF per subject. Restore picks PDFs and rebuilds
            cards with Gemini.
          </Text>
        ) : null}
      </View>

      {isSignedIn ? (
        <View style={{ gap: 10, marginTop: 16 }}>
          <PrimaryButton
            label={busy ? 'Working…' : 'Backup now'}
            variant="secondary"
            onPress={() => void run(backupNow)}
          />
          <PrimaryButton
            label={busy ? 'Working…' : 'Restore from backup'}
            variant="secondary"
            onPress={() => void run(restoreNow)}
          />
          <PrimaryButton
            label="Sign out"
            variant="danger"
            onPress={() =>
              void run(async () => {
                await signOut();
                return {
                  ok: true,
                  message:
                    "Signed out. This account's study data stays on this device and won't show under another account.",
                };
              })
            }
          />
        </View>
      ) : (
        <Text style={[styles.sub, { marginTop: 16 }]}>
          Sign in with Google to sync with Drive, or create an email account for
          PDF backups.
        </Text>
      )}

      <PrimaryButton
        label="Close"
        variant="secondary"
        onPress={onClose}
        style={{ marginTop: 12 }}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 18 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  meta: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.purpleTint,
  },
  metaLabel: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  metaValue: { color: colors.ink, fontWeight: '600', marginTop: 4, fontSize: 14 },
});
