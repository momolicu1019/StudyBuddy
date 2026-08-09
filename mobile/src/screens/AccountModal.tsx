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
  const { session, isSignedIn, backupNow, restoreNow, signOut } = useAuth();
  const initials = useAuthInitials();
  const [busy, setBusy] = useState(false);

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
              : 'Studying offline — create an email account to manage PDF backups'}
          </Text>
        </View>
      </View>

      <View style={styles.meta}>
        <Text style={styles.metaLabel}>PDF backup</Text>
        <Text style={styles.metaValue}>
          {isSignedIn
            ? session?.lastSyncedAt
              ? `Last export ${new Date(session.lastSyncedAt).toLocaleString()}`
              : 'Export subject folders as PDFs anytime'
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
                  message: 'Signed out. Local data stays on this device.',
                };
              })
            }
          />
        </View>
      ) : (
        <Text style={[styles.sub, { marginTop: 16 }]}>
          Create an email account from the login screen to export and restore PDF
          backups.
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
