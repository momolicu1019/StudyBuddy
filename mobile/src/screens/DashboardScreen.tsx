import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
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

import type { GenerateDraftResponse, Subject } from '../api/types';
import {
  AppModal,
  Card,
  IconBubble,
  PrimaryButton,
  SearchInput,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';

const FOLDER_ICONS = ['📚', '🧬', '🔬', '➗', '🌎', '📖', '💻', '🎨'];

function firstNameFrom(fullName?: string | null): string {
  const name = fullName?.trim();
  if (!name) return 'Student';
  return name.split(/\s+/)[0];
}

type SelectedSource = {
  name: string;
  type: 'pdf' | 'photo';
  uri: string;
};

export function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session } = useAuth();
  const {
    subjects,
    stats,
    showToast,
    createSubject,
    generateFromSource,
    saveDraftFlashcards,
  } = useApp();

  const greetName = firstNameFrom(session?.user.name);

  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [draft, setDraft] = useState<GenerateDraftResponse | null>(null);
  const [saveFolderId, setSaveFolderId] = useState<number | null>(null);
  const [savedSubject, setSavedSubject] = useState<Subject | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('📚');

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
    if (generating) return;
    setGenerating(true);
    showToast('Sending to Gemini for analysis…');
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
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Could not generate flashcards.';
      showToast(detail);
    } finally {
      setGenerating(false);
    }
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Hi, {greetName}! 👋</Text>
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
          <Text style={styles.subCenter}>Upload a PDF or take a photo</Text>
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
                {generating
                  ? 'Submitting to Gemini… then converting the summary into flashcards.'
                  : selectedSource.type === 'photo'
                    ? '📷 Photo ready. Tap generate to submit it to Gemini.'
                    : '📄 PDF ready. Tap generate to submit it to Gemini.'}
              </Text>
              <PrimaryButton
                label={generating ? '✨ Gemini is analyzing…' : '✨ Generate Flashcards'}
                onPress={onGenerate}
                style={{ marginTop: 12, opacity: generating ? 0.7 : 1 }}
              />
              <PrimaryButton
                label="Clear selection"
                variant="secondary"
                onPress={() => {
                  if (generating) return;
                  setSelectedSource(null);
                }}
                style={{ marginTop: 8 }}
              />
            </View>
          )}
        </Card>

        <View style={styles.tiles}>
          {[
            {
              icon: '🃏',
              title: 'Flashcards',
              desc: 'Browse subjects, study cards, and manage folders.',
              onPress: () => navigation.navigate('Flashcards'),
            },
            {
              icon: '🧠',
              title: 'Quiz Mode',
              desc: 'Test what you know and track your score.',
              onPress: () => navigation.navigate('Quiz', {}),
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
        {draft?.warning ? (
          <Text style={[styles.sub, { marginTop: 8, color: '#B45309' }]}>
            {draft.warning}
          </Text>
        ) : null}
        <View style={styles.sample}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>
            Sample key point · {draft?.count ?? 0} cards from Gemini
          </Text>
          {draft?.overview ? (
            <Text style={[styles.sub, { marginTop: 8 }]}>
              Analysis overview: {draft.overview}
            </Text>
          ) : null}
          <Text style={{ marginTop: 10, fontWeight: '700' }}>
            {draft?.sample_question}
          </Text>
          <Text style={[styles.sub, { marginTop: 6 }]}>{draft?.sample_answer}</Text>
        </View>

        <Text style={[styles.sub, { marginTop: 16, marginBottom: 8, fontWeight: '700' }]}>
          Save to subject
        </Text>

        {creatingFolder || subjects.length === 0 ? (
          <View style={styles.inlineEmpty}>
            <Text style={styles.sub}>
              {subjects.length === 0
                ? 'No subjects yet. Create one to save these flashcards.'
                : 'Name your new subject.'}
            </Text>
            <SearchInput
              value={folderName}
              onChangeText={setFolderName}
              placeholder="e.g. Biology"
              style={styles.folderNameInput}
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
                label="Create subject"
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
              label="+ New subject"
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
        <Text style={styles.h2}>Flashcards saved</Text>
        <Text style={[styles.sub, { marginTop: 8 }]}>
          {savedSubject
            ? `${savedSubject.icon} ${savedSubject.name} now has ${savedSubject.cards} flashcards. Open the Flashcards tab anytime to study or quiz.`
            : ''}
        </Text>
        <View style={[styles.row, { marginTop: 20 }]}>
          <PrimaryButton
            label="Open Flashcards"
            variant="secondary"
            onPress={() => {
              setSavedSubject(null);
              navigation.navigate('Flashcards');
            }}
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
    </KeyboardAvoidingView>
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
  folderNameInput: {
    marginTop: 14,
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 52,
  },
  sample: {
    marginTop: 14,
    backgroundColor: '#F7F6FF',
    borderRadius: 14,
    padding: 14,
  },
  tiles: { marginTop: 18, gap: 12 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: 16,
  },
  tileTitle: { fontSize: 17, fontWeight: '750' as unknown as '700', color: colors.ink },
  chevron: { fontSize: 28, color: colors.muted, marginTop: -4 },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  stat: { width: '47%', flexGrow: 1, minWidth: 140 },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primary,
  },
  statLabel: { color: colors.muted, marginTop: 4, fontSize: 13 },
});
