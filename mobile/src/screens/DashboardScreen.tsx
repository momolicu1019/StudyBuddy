import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { api } from '../api/client';
import type { DraftFlashcard, GenerateDraftResponse, Subject } from '../api/types';
import {
  AiDraftReviewFlow,
  type AiDraftPhase,
} from '../components/AiDraftReviewFlow';
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
import {
  getNearestNearingUrgency,
  needsDeadlineBulb,
  urgencyTone,
  type NearingUrgency,
} from '../storage/deadlineUtils';
import {
  DOCUMENT_PICKER_TYPES,
  detectSourceKind,
  shortLabelForSource,
  type SourceKind,
} from '../storage/sourceMime';
import { colors } from '../theme/colors';

const FOLDER_ICONS = ['📚', '🧬', '🔬', '➗', '🌎', '📖', '💻', '🎨'];

function firstNameFrom(fullName?: string | null): string {
  const name = fullName?.trim();
  if (!name) return 'Student';
  return name.split(/\s+/)[0];
}

type SelectedSource = {
  name: string;
  type: SourceKind;
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
  const [draftMeta, setDraftMeta] = useState<GenerateDraftResponse | null>(null);
  const [draftCards, setDraftCards] = useState<DraftFlashcard[]>([]);
  const [draftPhase, setDraftPhase] = useState<AiDraftPhase>('summary');
  const [saveFolderId, setSaveFolderId] = useState<number | null>(null);
  const [savedSubject, setSavedSubject] = useState<Subject | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('📚');
  const [deadlineBulb, setDeadlineBulb] = useState(false);
  const [deadlineSectionUrgency, setDeadlineSectionUrgency] =
    useState<NearingUrgency | null>(null);

  const draftOpen = draftMeta != null && draftCards.length > 0;

  function clearDraft() {
    setDraftMeta(null);
    setDraftCards([]);
    setDraftPhase('summary');
    setSaveFolderId(null);
    setCreatingFolder(false);
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const deadlines = await api.getDeadlines();
          if (active) {
            setDeadlineBulb(needsDeadlineBulb(deadlines));
            setDeadlineSectionUrgency(getNearestNearingUrgency(deadlines));
          }
        } catch {
          if (active) {
            setDeadlineBulb(false);
            setDeadlineSectionUrgency(null);
          }
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const hasProgress =
    stats.flashcards_reviewed > 0 ||
    stats.quiz_average > 0 ||
    stats.focus_hours > 0 ||
    subjects.some((s) => s.cards > 0);

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_PICKER_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const kind = detectSourceKind({
      filename: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      fallback: 'pdf',
    });
    setSelectedSource({ name: asset.name, type: kind, uri: asset.uri });
    clearDraft();
    setSavedSubject(null);
    showToast(`${shortLabelForSource(kind)} ready — tap Generate Flashcards`);
  }

  function applyPhotoSelection(asset: ImagePicker.ImagePickerAsset) {
    setSelectedSource({
      name: asset.fileName ?? 'note-photo.jpg',
      type: 'photo',
      uri: asset.uri,
    });
    clearDraft();
    setSavedSubject(null);
    showToast('Photo ready — tap Generate Flashcards');
  }

  async function takePhoto() {
    const camera = await ImagePicker.requestCameraPermissionsAsync();
    if (!camera.granted) {
      showToast('Camera permission is required to take a photo');
      return;
    }

    const photo = await ImagePicker.launchCameraAsync({
      quality: 1,
      allowsEditing: false,
    });
    if (photo.canceled || !photo.assets?.[0]) return;
    applyPhotoSelection(photo.assets[0]);
  }

  async function pickFromPhone() {
    const libraryPermission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!libraryPermission.granted) {
      showToast('Photo library permission is required to choose a photo');
      return;
    }

    const library = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      allowsMultipleSelection: false,
    });
    if (library.canceled || !library.assets?.[0]) return;
    applyPhotoSelection(library.assets[0]);
  }

  async function onGenerate() {
    if (!selectedSource) {
      showToast('Upload a file or choose a photo first');
      return;
    }
    if (generating) return;
    setGenerating(true);
    showToast(
      selectedSource.type === 'photo'
        ? 'Reading exact text from photo…'
        : 'Sending to Gemini for analysis…',
    );
    try {
      const result = await generateFromSource(
        selectedSource.type,
        selectedSource.name,
        selectedSource.uri,
      );
      setDraftMeta(result);
      setDraftCards(result.cards);
      setDraftPhase('summary');
      setSaveFolderId(subjects[0]?.id ?? null);
      setSelectedSource(null);
      showToast(`${result.count} flashcards ready to review`);
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
    if (!draftCards.length) return;
    if (!saveFolderId) {
      showToast('Create or select a folder first');
      startInlineCreateFolder();
      return;
    }

    setSaving(true);
    try {
      const result = await saveDraftFlashcards(saveFolderId, draftCards);
      setSavedSubject(result.subject);
      clearDraft();
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
            label="✨ AI Tutor"
            onPress={() => navigation.navigate('AITutor', {})}
            style={{ marginTop: 8 }}
          />
        </View>

        <Card style={styles.upload}>
          <IconBubble size={58}>📚</IconBubble>
          <Text style={styles.uploadTitle}>Create flashcards from your notes</Text>
          <Text style={styles.subCenter}>
            Upload a study file, take a photo, choose a photo, or type notes without AI
          </Text>
          <PrimaryButton
            label="📄 Upload file"
            onPress={() => void pickDocument()}
            style={{ marginTop: 16, alignSelf: 'stretch' }}
          />
          <View style={styles.row}>
            <PrimaryButton
              label="📷 Take Photo"
              onPress={() => void takePhoto()}
              variant="secondary"
              style={styles.flexBtn}
            />
            <PrimaryButton
              label="🖼️ Choose from Phone"
              onPress={() => void pickFromPhone()}
              variant="secondary"
              style={styles.flexBtn}
            />
          </View>
          <PrimaryButton
            label="✍️ Type Notes"
            onPress={() => navigation.navigate('TypeNotes')}
            variant="secondary"
            style={{ marginTop: 10, alignSelf: 'stretch' }}
          />

          {selectedSource && (
            <View style={styles.sourceBox}>
              <Text style={styles.sourceName}>{selectedSource.name}</Text>
              <Text style={styles.sub}>
                {generating
                  ? selectedSource.type === 'photo'
                    ? 'Extracting exact text → summarizing key points → building flashcards…'
                    : 'Submitting to AI… then converting the summary into flashcards.'
                  : selectedSource.type === 'photo'
                    ? '📷 Photo ready. Generate will copy the text word for word, summarize the important points, then make flashcards.'
                    : `📄 ${shortLabelForSource(selectedSource.type)} ready. Tap generate to analyze it.`}
              </Text>
              <PrimaryButton
                label={generating ? '✨ Analyzing…' : '✨ Generate Flashcards'}
                onPress={() => void onGenerate()}
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
              showBulb: false,
              highlight: null as NearingUrgency | null,
            },
            {
              icon: '🧠',
              title: 'Quiz Mode',
              desc: 'Test what you know and track your score.',
              onPress: () => navigation.navigate('Quiz', {}),
              showBulb: false,
              highlight: null as NearingUrgency | null,
            },
            {
              icon: '📅',
              title: 'Deadlines and Due Date',
              desc: 'Create due dates and track what is coming up.',
              onPress: () => navigation.navigate('Deadlines'),
              showBulb: deadlineBulb,
              highlight: deadlineSectionUrgency,
            },
            {
              icon: '✨',
              title: 'AI Tutor',
              desc: 'Pick a help mode — explain, hint, quiz, or learn without the answer.',
              onPress: () => navigation.navigate('AITutor', {}),
              showBulb: false,
              highlight: null as NearingUrgency | null,
            },
          ].map((tile) => {
            const tone = tile.highlight ? urgencyTone(tile.highlight) : null;
            return (
              <Pressable
                key={tile.title}
                style={[
                  styles.tile,
                  tone
                    ? {
                        borderColor: tone.border,
                        backgroundColor: tone.background,
                        borderWidth: 2,
                      }
                    : null,
                ]}
                onPress={tile.onPress}
              >
                <IconBubble size={54}>{tile.icon}</IconBubble>
                <View style={{ flex: 1 }}>
                  <View style={styles.tileTitleRow}>
                    <Text style={styles.tileTitle}>{tile.title}</Text>
                    {tile.showBulb ? (
                      <Text
                        style={styles.tileBulb}
                        accessibilityLabel="Upcoming deadline reminder"
                      >
                        💡
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.sub}>{tile.desc}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })}
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
        visible={draftOpen}
        onClose={() => {
          if (saving) return;
          clearDraft();
        }}
      >
        <AiDraftReviewFlow
          cards={draftCards}
          onChangeCards={setDraftCards}
          phase={draftPhase}
          onPhaseChange={setDraftPhase}
          onDiscard={clearDraft}
          subtitle={
            draftMeta?.overview
              ? `Overview: ${draftMeta.overview}`
              : draftMeta?.message
          }
          warning={draftMeta?.warning}
          saveSlot={
            <>
              <Text
                style={[
                  styles.sub,
                  { marginTop: 16, marginBottom: 8, fontWeight: '700' },
                ]}
              >
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
                        style={[
                          styles.chip,
                          folderIcon === icon && styles.chipActive,
                        ]}
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
                        style={[
                          styles.chip,
                          saveFolderId === s.id && styles.chipActive,
                        ]}
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
                  onPress={clearDraft}
                  style={styles.flexBtn}
                />
                <PrimaryButton
                  label={saving ? 'Saving…' : 'Save flashcards'}
                  onPress={() => void onSaveDraft()}
                  style={styles.flexBtn}
                />
              </View>
            </>
          }
        />
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
  tileTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  tileBulb: { fontSize: 16 },
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
