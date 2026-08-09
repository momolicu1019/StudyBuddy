import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { GenerateDraftResponse, Subject } from '../api/types';
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

type SelectedSource = {
  name: string;
  type: 'pdf' | 'photo';
  uri: string;
};

export function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    subjects,
    stats,
    showToast,
    createSubject,
    updateSubject,
    generateFromSource,
    saveDraftFlashcards,
  } = useApp();

  const [search, setSearch] = useState('');
  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [draft, setDraft] = useState<GenerateDraftResponse | null>(null);
  const [saveFolderId, setSaveFolderId] = useState<number | null>(null);
  const [savedSubject, setSavedSubject] = useState<Subject | null>(null);

  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('📚');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Subject | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter((s) => s.name.toLowerCase().includes(q));
  }, [subjects, search]);

  const livePreview = preview
    ? subjects.find((s) => s.id === preview.id) ?? preview
    : null;

  const hasProgress =
    stats.flashcards_reviewed > 0 ||
    stats.quiz_average > 0 ||
    stats.focus_hours > 0 ||
    subjects.some((s) => s.cards > 0);

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setSelectedSource({ name: asset.name, type: 'pdf', uri: asset.uri });
    setDraft(null);
    setSavedSubject(null);
    showToast('PDF ready — tap Generate Flashcards');
  }

  async function pickPhoto() {
    const camera = await ImagePicker.requestCameraPermissionsAsync();
    if (camera.granted) {
      const photo = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: false,
      });
      if (photo.canceled || !photo.assets?.[0]) return;
      const asset = photo.assets[0];
      setSelectedSource({
        name: asset.fileName ?? 'note-photo.jpg',
        type: 'photo',
        uri: asset.uri,
      });
      setDraft(null);
      setSavedSubject(null);
      showToast('Photo ready — tap Generate Flashcards');
      return;
    }

    const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!libraryPermission.granted) {
      showToast('Camera or photo library permission is required');
      return;
    }

    const library = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (library.canceled || !library.assets?.[0]) return;
    const asset = library.assets[0];
    setSelectedSource({
      name: asset.fileName ?? 'note-photo.jpg',
      type: 'photo',
      uri: asset.uri,
    });
    setDraft(null);
    setSavedSubject(null);
    showToast('Photo ready — tap Generate Flashcards');
  }

  async function onGenerate() {
    if (!selectedSource) {
      showToast('Upload a PDF or take a photo first');
      return;
    }
    setGenerating(true);
    try {
      const result = await generateFromSource(
        selectedSource.type,
        selectedSource.name,
        selectedSource.uri,
      );
      setDraft(result);
      setSaveFolderId(subjects[0]?.id ?? null);
      setSelectedSource(null);
      showToast(`${result.count} flashcards ready to save`);
    } catch {
      showToast('Could not generate flashcards. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  function openManageFolder(subject?: Subject) {
    if (subject) {
      setEditingId(subject.id);
      setFolderName(subject.name);
      setFolderIcon(subject.icon);
    } else {
      setEditingId(null);
      setFolderName('');
      setFolderIcon('📚');
    }
    setCreatingFolder(false);
    setFolderModal(true);
  }

  function startInlineCreateFolder() {
    setFolderName('');
    setFolderIcon('📚');
    setCreatingFolder(true);
  }

  async function createFolderInline() {
    const name = folderName.trim();
    if (!name) {
      showToast('Please enter a folder name');
      return;
    }
    setCreatingFolder(false);
    const created = await createSubject(name, folderIcon);
    setSaveFolderId(created.id);
    setFolderName('');
    setFolderIcon('📚');
  }

  async function saveFolder() {
    const name = folderName.trim();
    if (!name) {
      showToast('Please enter a folder name');
      return;
    }

    if (editingId) {
      await updateSubject(editingId, name, folderIcon);
    } else {
      await createSubject(name, folderIcon);
    }
    setFolderModal(false);
  }

  async function onSaveDraft() {
    if (!draft) return;
    if (!saveFolderId) {
      showToast('Create or select a folder first');
      startInlineCreateFolder();
      return;
    }

    setSaving(true);
    try {
      const result = await saveDraftFlashcards(saveFolderId, draft.cards);
      setSavedSubject(result.subject);
      setPreview(result.subject);
      setDraft(null);
      setSaveFolderId(null);
      showToast(result.message);
    } catch {
      showToast('Could not save flashcards. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Hi, Student! 👋</Text>
            <Text style={styles.sub}>What would you like to study today?</Text>
          </View>
          <PrimaryButton
            label="Ask AI Tutor"
            onPress={() => navigation.navigate('AITutor', {})}
            style={{ marginTop: 8 }}
          />
        </View>

        <Card style={styles.upload}>
          <IconBubble size={58}>📚</IconBubble>
          <Text style={styles.uploadTitle}>Create flashcards from your notes</Text>
          <Text style={styles.subCenter}>
            Upload a PDF or take a photo, generate flashcards, then save them to a folder.
          </Text>
          <View style={styles.row}>
            <PrimaryButton label="📄 Upload PDF" onPress={pickPdf} style={styles.flexBtn} />
            <PrimaryButton
              label="📷 Take a Photo"
              onPress={pickPhoto}
              variant="secondary"
              style={styles.flexBtn}
            />
          </View>

          {selectedSource && (
            <View style={styles.sourceBox}>
              <Text style={styles.sourceName}>{selectedSource.name}</Text>
              <Text style={styles.sub}>
                {selectedSource.type === 'photo'
                  ? '📷 Photo selected. Generate flashcards from this image.'
                  : '📄 PDF selected. Generate flashcards from this document.'}
              </Text>
              <PrimaryButton
                label={
                  generating
                    ? '✨ Generating…'
                    : selectedSource.type === 'photo'
                      ? '✨ Generate Flashcard'
                      : '✨ Generate Flashcards'
                }
                onPress={onGenerate}
                style={{ marginTop: 12 }}
              />
              <PrimaryButton
                label="Clear selection"
                variant="secondary"
                onPress={() => setSelectedSource(null)}
                style={{ marginTop: 8 }}
              />
            </View>
          )}
        </Card>

        <Card style={{ marginTop: 16 }}>
          <View style={styles.flashHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h2}>📚 My Flashcards</Text>
              <Text style={styles.sub}>
                Saved flashcard folders appear here after you generate and save.
              </Text>
            </View>
          </View>
          <View style={styles.tools}>
            <SearchInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search folders..."
            />
            <PrimaryButton label="+ New" onPress={() => openManageFolder()} />
          </View>

          <View style={styles.subjects}>
            {filtered.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.sub}>
                  No flashcard folders yet. Upload notes, generate cards, then create a
                  folder to save them.
                </Text>
                <PrimaryButton
                  label="Create a folder"
                  onPress={() => openManageFolder()}
                  style={{ marginTop: 12 }}
                />
              </View>
            ) : (
              filtered.map((s) => {
                const pct = s.cards ? Math.round((s.mastered / s.cards) * 100) : 0;
                return (
                  <Pressable
                    key={s.id}
                    style={styles.subject}
                    onPress={() => setPreview(s)}
                  >
                    <View style={styles.subjectTop}>
                      <IconBubble>{s.icon}</IconBubble>
                      <Pressable
                        onPress={() => openManageFolder(s)}
                        style={styles.menuBtn}
                      >
                        <Text style={{ color: colors.muted }}>⋯</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.subjectName}>{s.name}</Text>
                    <Text style={styles.sub}>
                      {s.cards === 0
                        ? 'No flashcards yet'
                        : `${s.cards} flashcards · ${pct}% mastered`}
                    </Text>
                    <ProgressBar value={pct} />
                  </Pressable>
                );
              })
            )}
          </View>

          {livePreview && (
            <View style={styles.preview}>
              <Text style={styles.previewTitle}>
                {livePreview.icon} {livePreview.name}
              </Text>
              <Text style={styles.sub}>
                {livePreview.cards === 0
                  ? 'No flashcards yet — generate from a PDF or photo, then save here.'
                  : `${livePreview.cards} flashcards ready · ${livePreview.mastered} mastered · Last studied ${livePreview.last}.`}
              </Text>
              <View style={[styles.row, { marginTop: 11 }]}>
                <PrimaryButton
                  label="Study"
                  onPress={() =>
                    navigation.navigate('Study', { subjectId: livePreview.id })
                  }
                  style={styles.flexBtn}
                />
                <PrimaryButton
                  label="Quiz"
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate('Quiz', { subjectId: livePreview.id })
                  }
                  style={styles.flexBtn}
                />
              </View>
            </View>
          )}
        </Card>

        <View style={styles.tiles}>
          {[
            {
              icon: '🃏',
              title: 'Flashcards',
              desc: 'Browse subjects, folders, and study cards.',
              onPress: () => navigation.navigate('Flashcards'),
            },
            {
              icon: '🧠',
              title: 'Quiz Mode',
              desc: 'Test what you know and track your score.',
              onPress: () => navigation.navigate('Quiz', {}),
            },
            {
              icon: '🔊',
              title: 'Voice Explain',
              desc: 'Listen to difficult topics explained simply.',
              onPress: () => showToast('Voice explanation ready'),
            },
            {
              icon: '✨',
              title: 'AI Tutor',
              desc: 'Ask questions and get step-by-step help.',
              onPress: () => navigation.navigate('AITutor', {}),
            },
          ].map((tile) => (
            <Pressable key={tile.title} style={styles.tile} onPress={tile.onPress}>
              <IconBubble size={54}>{tile.icon}</IconBubble>
              <View style={{ flex: 1 }}>
                <Text style={styles.tileTitle}>{tile.title}</Text>
                <Text style={styles.sub}>{tile.desc}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.h2, { marginTop: 8, marginBottom: 14 }]}>
          Your study progress
        </Text>
        {!hasProgress ? (
          <Card style={{ marginBottom: 8 }}>
            <Text style={styles.sub}>
              Progress appears after you upload notes, study flashcards, take a quiz,
              or finish a focus session.
            </Text>
          </Card>
        ) : null}
        <View style={styles.stats}>
          <Card style={styles.stat}>
            <Text style={styles.statValue}>{stats.flashcards_reviewed}</Text>
            <Text style={styles.statLabel}>Flashcards reviewed</Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={styles.statValue}>{stats.quiz_average}%</Text>
            <Text style={styles.statLabel}>Quiz average</Text>
          </Card>
          <Card style={[styles.stat, { width: '100%' }]}>
            <Text style={styles.statValue}>{stats.focus_hours}h</Text>
            <Text style={styles.statLabel}>This week's focus time</Text>
          </Card>
        </View>

        <Card style={{ marginTop: 16, marginBottom: 30 }}>
          <Text style={styles.h2}>Focus session</Text>
          <Text style={[styles.sub, { marginTop: 6, marginBottom: 14 }]}>
            Jump into a Pomodoro timer to stay on track.
          </Text>
          <PrimaryButton
            label="Open Pomodoro"
            onPress={() => navigation.navigate('Pomodoro')}
          />
        </Card>
      </ScrollView>

      <AppModal
        visible={!!draft}
        onClose={() => {
          setDraft(null);
          setSaveFolderId(null);
          setCreatingFolder(false);
        }}
      >
        <Text style={styles.h2}>✨ Flashcards generated!</Text>
        <Text style={[styles.sub, { marginTop: 8 }]}>{draft?.message}</Text>
        <View style={styles.sample}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>
            Sample · {draft?.count ?? 0} cards ready
          </Text>
          <Text style={{ marginTop: 10, fontWeight: '700' }}>
            {draft?.sample_question}
          </Text>
          <Text style={[styles.sub, { marginTop: 6 }]}>{draft?.sample_answer}</Text>
        </View>

        <Text style={[styles.sub, { marginTop: 16, marginBottom: 8, fontWeight: '700' }]}>
          Save to folder
        </Text>

        {creatingFolder || subjects.length === 0 ? (
          <View style={styles.inlineEmpty}>
            <Text style={styles.sub}>
              {subjects.length === 0
                ? 'No folders yet. Create one to save these flashcards.'
                : 'Name your new folder.'}
            </Text>
            <SearchInput
              value={folderName}
              onChangeText={setFolderName}
              placeholder="e.g. Biology"
            />
            <View style={[styles.subjectChips, { marginTop: 12 }]}>
              {FOLDER_ICONS.map((icon) => (
                <Pressable
                  key={icon}
                  onPress={() => setFolderIcon(icon)}
                  style={[styles.chip, folderIcon === icon && styles.chipActive]}
                >
                  <Text style={{ fontSize: 18 }}>{icon}</Text>
                </Pressable>
              ))}
            </View>
            <View style={[styles.row, { marginTop: 12 }]}>
              {subjects.length > 0 ? (
                <PrimaryButton
                  label="Back"
                  variant="secondary"
                  onPress={() => setCreatingFolder(false)}
                  style={styles.flexBtn}
                />
              ) : null}
              <PrimaryButton
                label="Create folder"
                onPress={createFolderInline}
                style={styles.flexBtn}
              />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.subjectChips}>
              {subjects.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setSaveFolderId(s.id)}
                  style={[styles.chip, saveFolderId === s.id && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      saveFolderId === s.id && styles.chipTextActive,
                    ]}
                  >
                    {s.icon} {s.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <PrimaryButton
              label="+ New folder"
              variant="secondary"
              onPress={startInlineCreateFolder}
              style={{ marginTop: 10 }}
            />
          </>
        )}

        <View style={[styles.row, { marginTop: 20 }]}>
          <PrimaryButton
            label="Discard"
            variant="secondary"
            onPress={() => {
              setDraft(null);
              setSaveFolderId(null);
              setCreatingFolder(false);
            }}
            style={styles.flexBtn}
          />
          <PrimaryButton
            label={saving ? 'Saving…' : 'Save flashcards'}
            onPress={onSaveDraft}
            style={styles.flexBtn}
          />
        </View>
      </AppModal>

      <AppModal visible={!!savedSubject} onClose={() => setSavedSubject(null)}>
        <Text style={styles.h2}>Saved to My Flashcards</Text>
        <Text style={[styles.sub, { marginTop: 8 }]}>
          {savedSubject
            ? `${savedSubject.icon} ${savedSubject.name} now has ${savedSubject.cards} flashcards.`
            : ''}
        </Text>
        <View style={[styles.row, { marginTop: 20 }]}>
          <PrimaryButton
            label="Close"
            variant="secondary"
            onPress={() => setSavedSubject(null)}
            style={styles.flexBtn}
          />
          <PrimaryButton
            label="Start Studying"
            onPress={() => {
              const id = savedSubject?.id;
              setSavedSubject(null);
              if (id) navigation.navigate('Study', { subjectId: id });
            }}
            style={styles.flexBtn}
          />
        </View>
      </AppModal>

      <AppModal visible={folderModal} onClose={() => setFolderModal(false)}>
        <Text style={styles.h2}>
          {editingId ? 'Rename folder' : 'Create a folder'}
        </Text>
        <Text style={[styles.sub, { marginTop: 6 }]}>
          Organize your flashcards by subject or topic.
        </Text>
        <SearchInput
          value={folderName}
          onChangeText={setFolderName}
          placeholder="e.g. Biology"
        />
        <View style={[styles.subjectChips, { marginTop: 12 }]}>
          {FOLDER_ICONS.map((icon) => (
            <Pressable
              key={icon}
              onPress={() => setFolderIcon(icon)}
              style={[styles.chip, folderIcon === icon && styles.chipActive]}
            >
              <Text style={{ fontSize: 18 }}>{icon}</Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.row, { marginTop: 20 }]}>
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={() => setFolderModal(false)}
            style={styles.flexBtn}
          />
          <PrimaryButton
            label={editingId ? 'Save changes' : 'Create folder'}
            onPress={saveFolder}
            style={styles.flexBtn}
          />
        </View>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  hero: { marginBottom: 18 },
  h1: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 6,
  },
  h2: { fontSize: 20, fontWeight: '800', color: colors.ink, margin: 0 },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  subCenter: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  upload: { alignItems: 'center' },
  uploadTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 10,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  flexBtn: { flex: 1 },
  sourceBox: {
    marginTop: 16,
    width: '100%',
    backgroundColor: '#F3F2FF',
    borderRadius: 14,
    padding: 13,
  },
  sourceName: { fontWeight: '700', color: colors.ink, marginBottom: 4 },
  subjectChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  chipText: { color: colors.muted, fontWeight: '600' },
  chipTextActive: { color: colors.primary },
  inlineEmpty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D7D5E7',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  flashHead: { marginBottom: 12 },
  tools: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'center' },
  subjects: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  subject: {
    width: '47%',
    flexGrow: 1,
    minWidth: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fff',
  },
  subjectTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#F5F4FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subjectName: {
    marginTop: 12,
    marginBottom: 4,
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  empty: {
    width: '100%',
    padding: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D7D5E7',
    borderRadius: 15,
    alignItems: 'center',
  },
  preview: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.purpleTint,
  },
  previewTitle: { color: colors.primary, fontWeight: '700', marginBottom: 4 },
  tiles: { marginTop: 18, gap: 12 },
  tile: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 105,
    shadowColor: '#251f4d',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  tileTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  chevron: { fontSize: 28, color: colors.muted },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { width: '47%', flexGrow: 1 },
  statValue: { fontSize: 25, fontWeight: '800', color: colors.ink },
  statLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  sample: {
    backgroundColor: colors.purpleTint,
    borderRadius: 15,
    padding: 16,
    marginTop: 15,
  },
});
