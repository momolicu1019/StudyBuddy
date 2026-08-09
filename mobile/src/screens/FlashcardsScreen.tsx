import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { Subject } from '../api/types';
import {
  AppModal,
  Card,
  IconBubble,
  PrimaryButton,
  ProgressBar,
  SearchInput,
} from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';

const FOLDER_ICONS = ['📚', '🧬', '🔬', '➗', '🌎', '📖', '💻', '🎨'];

export function FlashcardsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    subjects,
    showToast,
    createSubject,
    updateSubject,
    deleteSubject,
  } = useApp();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Subject | null>(null);
  const [folderModal, setFolderModal] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('📚');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter((s) => s.name.toLowerCase().includes(q));
  }, [subjects, search]);

  function openFolderModal(subject?: Subject) {
    if (subject) {
      setEditingId(subject.id);
      setFolderName(subject.name);
      setFolderIcon(subject.icon);
    } else {
      setEditingId(null);
      setFolderName('');
      setFolderIcon('📚');
    }
    setFolderModal(true);
  }

  async function saveFolder() {
    const name = folderName.trim();
    if (!name) {
      showToast('Please enter a subject name');
      return;
    }
    if (editingId) await updateSubject(editingId, name, folderIcon);
    else await createSubject(name, folderIcon);
    setFolderModal(false);
  }

  const liveSelected = selected
    ? subjects.find((s) => s.id === selected.id) ?? null
    : null;

  if (liveSelected) {
    const pct = liveSelected.cards
      ? Math.round((liveSelected.mastered / liveSelected.cards) * 100)
      : 0;
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Pressable onPress={() => setSelected(null)} style={styles.backBtn}>
          <Text style={styles.backText}>← All Subjects</Text>
        </Pressable>
        <Card>
          <View style={styles.detailHead}>
            <IconBubble size={64}>{liveSelected.icon}</IconBubble>
            <View style={{ flex: 1 }}>
              <Text style={styles.h1}>{liveSelected.name}</Text>
              <Text style={styles.sub}>
                {liveSelected.cards === 0
                  ? 'No flashcards yet — upload notes from the Dashboard.'
                  : `Your ${liveSelected.name} study deck`}
              </Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <View style={styles.statPill}>
              <Text style={styles.statStrong}>{liveSelected.cards}</Text>
              <Text style={styles.statSpan}>Flashcards</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statStrong}>{liveSelected.mastered}</Text>
              <Text style={styles.statSpan}>Mastered</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statStrong}>{pct}%</Text>
              <Text style={styles.statSpan}>Progress</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <PrimaryButton
              label="Study Flashcards"
              onPress={() =>
                navigation.navigate('Study', { subjectId: liveSelected.id })
              }
            />
            <PrimaryButton
              label="Quiz This Subject"
              variant="secondary"
              onPress={() =>
                navigation.navigate('Quiz', { subjectId: liveSelected.id })
              }
            />
            <PrimaryButton
              label="Ask AI Tutor"
              variant="secondary"
              onPress={() =>
                navigation.navigate('AITutor', { subject: liveSelected.name })
              }
            />
          </View>
        </Card>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.h1}>🃏 Flashcards</Text>
        <Text style={[styles.sub, { marginBottom: 18 }]}>
          Choose a subject and start learning.
        </Text>

        <View style={styles.tools}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="🔍 Search subjects..."
            style={styles.toolsSearch}
          />
          <PrimaryButton label="+ New Subject" onPress={() => openFolderModal()} />
        </View>

        <View style={styles.grid}>
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.sub}>
                No subject folders yet. Create one, then upload notes or a photo.
              </Text>
            </View>
          ) : (
            filtered.map((s) => {
              const pct = s.cards ? Math.round((s.mastered / s.cards) * 100) : 0;
              return (
                <Pressable
                  key={s.id}
                  style={styles.folder}
                  onPress={() => setSelected(s)}
                >
                  <View style={styles.folderHead}>
                    <IconBubble size={54}>{s.icon}</IconBubble>
                    <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
                  </View>
                  <Text style={styles.folderName}>{s.name}</Text>
                  <Text style={styles.sub}>
                    {s.cards === 0
                      ? 'No flashcards yet'
                      : `${s.cards} flashcards · ${pct}% mastered`}
                  </Text>
                  <ProgressBar value={pct} />
                  <View style={styles.folderActions}>
                    <Pressable
                      style={styles.actionBtn}
                      onPress={() => openFolderModal(s)}
                    >
                      <Text style={styles.actionText}>Rename</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionBtn, styles.dangerBtn]}
                      onPress={() => setDeleteId(s.id)}
                    >
                      <Text style={[styles.actionText, { color: '#C63E57' }]}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      <AppModal visible={folderModal} onClose={() => setFolderModal(false)}>
        <Text style={styles.h2}>
          {editingId ? 'Rename subject' : 'Create a subject'}
        </Text>
        <Text style={[styles.sub, { marginVertical: 8 }]}>
          Give your flashcards a subject folder.
        </Text>
        <SearchInput
          value={folderName}
          onChangeText={setFolderName}
          placeholder="e.g. Biology"
          style={styles.folderNameInput}
        />
        <View style={styles.icons}>
          {FOLDER_ICONS.map((icon) => (
            <Pressable
              key={icon}
              onPress={() => setFolderIcon(icon)}
              style={[styles.iconChip, folderIcon === icon && styles.iconChipActive]}
            >
              <Text style={{ fontSize: 18 }}>{icon}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.modalActions}>
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={() => setFolderModal(false)}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label={editingId ? 'Save changes' : 'Create subject'}
            onPress={saveFolder}
            style={{ flex: 1 }}
          />
        </View>
      </AppModal>

      <AppModal visible={deleteId !== null} onClose={() => setDeleteId(null)}>
        <View style={{ alignItems: 'center' }}>
          <View style={styles.confirmIcon}>
            <Text style={{ fontSize: 29 }}>🗑️</Text>
          </View>
          <Text style={styles.h2}>Delete this subject?</Text>
          <Text style={[styles.sub, { textAlign: 'center', marginTop: 8 }]}>
            Are you sure you want to delete "
            {subjects.find((s) => s.id === deleteId)?.name}"?
          </Text>
          <View style={styles.warning}>
            <Text style={styles.warningText}>
              This will remove the subject folder and its flashcards. This action
              cannot be undone.
            </Text>
          </View>
          <View style={styles.modalActions}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={() => setDeleteId(null)}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              label="Yes, Delete Folder"
              variant="danger"
              onPress={async () => {
                if (deleteId !== null) await deleteSubject(deleteId);
                setDeleteId(null);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </AppModal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink, margin: 0 },
  h2: { fontSize: 20, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  tools: { flexDirection: 'row', gap: 10, marginBottom: 16, alignItems: 'center' },
  toolsSearch: { flex: 1, width: undefined, minWidth: 0 },
  folderNameInput: {
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 52,
  },
  grid: { gap: 14 },
  folder: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    padding: 19,
    shadowColor: '#251f4d',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  folderHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  folderName: {
    marginTop: 15,
    marginBottom: 4,
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
  },
  folderActions: { flexDirection: 'row', gap: 8, marginTop: 15 },
  actionBtn: {
    backgroundColor: '#F2F1F8',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  dangerBtn: { backgroundColor: colors.dangerSoft },
  actionText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  empty: {
    padding: 45,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D8D6E7',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  backBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 15,
  },
  backText: { fontWeight: '700', color: colors.ink },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 20 },
  statPill: {
    backgroundColor: '#F5F4FB',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  statStrong: { fontSize: 18, fontWeight: '800', color: colors.ink },
  statSpan: { fontSize: 11, color: colors.muted },
  actions: { gap: 10 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  iconChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 11,
    padding: 10,
    backgroundColor: '#fff',
  },
  iconChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    width: '100%',
  },
  confirmIcon: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  warning: {
    backgroundColor: '#FFF7E8',
    borderRadius: 11,
    padding: 12,
    marginTop: 16,
    width: '100%',
  },
  warningText: { color: '#93651B', fontSize: 12, lineHeight: 18 },
});
