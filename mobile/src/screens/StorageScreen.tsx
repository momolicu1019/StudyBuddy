import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { AppModal, Card, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import {
  formatBytes,
  type StorageBreakdown,
} from '../storage/storageManager';
import { colors } from '../theme/colors';

export function StorageScreen() {
  const { showToast } = useApp();
  const [data, setData] = useState<StorageBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmFree, setConfirmFree] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const breakdown = await api.getStorageBreakdown();
      setData(breakdown);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  async function toggleAutoDelete() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const next = !data.auto_delete_enabled;
      await api.updateSettings({ delete_sources_after_flashcards: next });
      setData({ ...data, auto_delete_enabled: next });
      showToast(
        next
          ? 'Uploaded files will be deleted after flashcards are saved (Keep files are skipped)'
          : 'Uploaded files will be kept after flashcards are saved',
      );
    } catch {
      showToast('Could not update storage setting');
    } finally {
      setBusy(false);
    }
  }

  async function toggleKeep(sourceId: number, keep: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setSourceKeep(sourceId, keep);
      await load();
      showToast(keep ? 'File marked Keep' : 'Keep removed — eligible for cleanup');
    } catch {
      showToast('Could not update file');
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(sourceId: number) {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteStoredSource(sourceId);
      setPendingDeleteId(null);
      await load();
      showToast('Source file deleted — flashcards were kept');
    } catch {
      showToast('Could not delete that file');
    } finally {
      setBusy(false);
    }
  }

  async function freeDisposable() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.deleteDisposableSources();
      setConfirmFree(false);
      await load();
      if (!result.deleted) {
        showToast(
          'Nothing to remove. Unmark Keep on used files, or turn on auto-delete for next saves.',
        );
      } else {
        showToast(
          `Removed ${result.deleted} file${result.deleted === 1 ? '' : 's'} · freed ${formatBytes(result.bytes_freed)}. Flashcards kept.`,
        );
      }
    } catch {
      showToast('Could not free storage');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const breakdown = data ?? {
    pdfs_bytes: 0,
    photos_bytes: 0,
    flashcards_bytes: 0,
    ai_data_bytes: 0,
    total_bytes: 0,
    sources: [],
    auto_delete_enabled: false,
  };

  const rows = [
    { label: 'PDFs', bytes: breakdown.pdfs_bytes },
    { label: 'Note photos', bytes: breakdown.photos_bytes },
    { label: 'Flashcards', bytes: breakdown.flashcards_bytes },
    { label: 'AI data', bytes: breakdown.ai_data_bytes },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Storage</Text>
      <Text style={styles.brandLine}>Study Buddy</Text>
      <View style={styles.rule} />

      <Card style={{ marginTop: 8 }}>
        {rows.map((row) => (
          <View key={row.label} style={styles.rowLine}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={styles.rowValue}>{formatBytes(row.bytes)}</Text>
          </View>
        ))}
        <View style={styles.totalRule} />
        <View style={styles.rowLine}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {formatBytes(breakdown.total_bytes)}
          </Text>
        </View>
      </Card>

      <PrimaryButton
        label={managing ? 'Hide Manage Storage' : 'Manage Storage'}
        onPress={() => setManaging((v) => !v)}
        style={{ marginTop: 16 }}
      />

      {managing ? (
        <Card style={{ marginTop: 14 }}>
          <Text style={styles.sectionTitle}>Smart cleanup</Text>
          <Text style={[styles.sub, { marginTop: 6 }]}>
            Delete uploaded source copies after flashcards are created, while
            keeping the generated flashcards. Files marked Keep are never
            removed automatically.
          </Text>

          <Pressable
            onPress={() => void toggleAutoDelete()}
            style={[
              styles.toggle,
              breakdown.auto_delete_enabled && styles.toggleOn,
            ]}
          >
            <Text
              style={[
                styles.toggleTitle,
                breakdown.auto_delete_enabled && styles.toggleTitleOn,
              ]}
            >
              Delete files after flashcards are created
            </Text>
            <Text style={styles.sub}>
              {breakdown.auto_delete_enabled
                ? 'On — frees space after each save (Keep files stay)'
                : 'Off — keep all original uploads by default'}
            </Text>
          </Pressable>

          <PrimaryButton
            label="Free space from used files"
            variant="secondary"
            onPress={() => setConfirmFree(true)}
            style={{ marginTop: 12 }}
          />
          <Text style={[styles.sub, { marginTop: 8 }]}>
            Removes source files already used for flashcards that are not marked
            Keep. Your flashcards stay.
          </Text>

          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
            Stored files
          </Text>
          {breakdown.sources.length === 0 ? (
            <Text style={[styles.sub, { marginTop: 8 }]}>
              No uploaded PDFs or note photos stored yet.
            </Text>
          ) : (
            <View style={{ gap: 10, marginTop: 10 }}>
              {breakdown.sources.map((source) => (
                <View key={source.id} style={styles.fileRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {source.category === 'photo' ? '🖼️' : '📄'} {source.name}
                    </Text>
                    <Text style={styles.sub}>
                      {formatBytes(source.bytes)}
                      {source.used_for_flashcards ? ' · used for cards' : ''}
                      {source.keep === true ? ' · Keep' : ''}
                    </Text>
                  </View>
                  <View style={styles.fileActions}>
                    <PrimaryButton
                      label={source.keep === true ? 'Unkeep' : 'Keep'}
                      variant="secondary"
                      onPress={() =>
                        void toggleKeep(source.id, source.keep !== true)
                      }
                      style={styles.miniBtn}
                    />
                    <PrimaryButton
                      label="Delete"
                      variant="danger"
                      onPress={() => setPendingDeleteId(source.id)}
                      style={styles.miniBtn}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>
      ) : null}

      <Text style={[styles.note, { marginTop: 16, marginBottom: 28 }]}>
        Note: Original uploads stay on your device by default. Cleanup only
        removes Study Buddy’s local copies — never your flashcards.
      </Text>

      <AppModal visible={confirmFree} onClose={() => setConfirmFree(false)}>
        <Text style={styles.modalTitle}>Free up storage?</Text>
        <Text style={[styles.sub, { marginTop: 8 }]}>
          This deletes source files that already produced flashcards and are not
          marked Keep. Flashcards are not deleted.
        </Text>
        <View style={styles.modalRow}>
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={() => setConfirmFree(false)}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label={busy ? 'Working…' : 'Free space'}
            onPress={() => void freeDisposable()}
            style={{ flex: 1 }}
          />
        </View>
      </AppModal>

      <AppModal
        visible={pendingDeleteId != null}
        onClose={() => setPendingDeleteId(null)}
      >
        <Text style={styles.modalTitle}>Delete this source file?</Text>
        <Text style={[styles.sub, { marginTop: 8 }]}>
          The uploaded copy will be removed from Study Buddy storage. Any
          flashcards already created from it will stay.
        </Text>
        <View style={styles.modalRow}>
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={() => setPendingDeleteId(null)}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label={busy ? 'Deleting…' : 'Delete file'}
            variant="danger"
            onPress={() => {
              if (pendingDeleteId != null) void deleteOne(pendingDeleteId);
            }}
            style={{ flex: 1 }}
          />
        </View>
      </AppModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink },
  brandLine: {
    marginTop: 4,
    color: colors.muted,
    fontWeight: '700',
    fontSize: 15,
  },
  rule: {
    height: 1,
    backgroundColor: colors.line,
    marginTop: 12,
    marginBottom: 8,
  },
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowLabel: { color: colors.ink, fontWeight: '600', fontSize: 15 },
  rowValue: { color: colors.muted, fontWeight: '700', fontSize: 15 },
  totalRule: {
    height: 1,
    backgroundColor: colors.line,
    marginTop: 4,
    marginBottom: 4,
  },
  totalLabel: { color: colors.ink, fontWeight: '800', fontSize: 16 },
  totalValue: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  sectionTitle: { color: colors.ink, fontWeight: '800', fontSize: 17 },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  toggle: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
  },
  toggleOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  toggleTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  toggleTitleOn: { color: colors.primary },
  fileRow: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    gap: 10,
  },
  fileName: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  fileActions: { flexDirection: 'row', gap: 8 },
  miniBtn: { flex: 1, paddingVertical: 10 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
});
