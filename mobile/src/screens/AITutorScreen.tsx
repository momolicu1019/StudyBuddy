import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import type { DraftFlashcard } from '../api/types';
import { AppModal, Card, PrimaryButton, SearchInput } from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { buildFlashcardsFromTutorReply } from '../storage/flashcardGenerator';
import { friendlyAiError } from '../storage/geminiClient';
import {
  isCloudTutorConfigured,
  isFlashcardWorthyTutorReply,
} from '../storage/tutorEngine';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'AITutor'>;

type ChatItem = {
  role: 'user' | 'assistant';
  text: string;
  /** Real tutor answers can be turned into flashcards. */
  allowFlashcards?: boolean;
};

const FOLDER_ICONS = ['📚', '🧬', '🔬', '➗', '🌎', '📖', '💻', '🎨'];

export function AITutorScreen({ route }: Props) {
  const subject = route.params?.subject;
  const {
    subjects,
    showToast,
    createSubject,
    saveDraftFlashcards,
  } = useApp();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const cloudReady = isCloudTutorConfigured();
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      role: 'assistant',
      text: subject
        ? `Hi! I'm your AI Tutor for ${subject}. Ask a real question and I'll answer it using your notes${cloudReady ? ' and AI' : ''}.`
        : `Hi! I'm your Study Buddy AI Tutor. Ask a content question (for example “What is photosynthesis?”) and I'll answer it${cloudReady ? '' : ' from your flashcards'}.`,
    },
  ]);

  const [cardSource, setCardSource] = useState<{
    reply: string;
    question?: string;
  } | null>(null);
  const [draftCards, setDraftCards] = useState<DraftFlashcard[] | null>(null);
  const [makingCards, setMakingCards] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFolderId, setSaveFolderId] = useState<number | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('📚');

  const matchedSubjectId = useMemo(() => {
    if (!subject) return subjects[0]?.id ?? null;
    return (
      subjects.find((s) => s.name.toLowerCase() === subject.trim().toLowerCase())
        ?.id ??
      subjects[0]?.id ??
      null
    );
  }, [subject, subjects]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (saveFolderId == null && matchedSubjectId != null && !creatingFolder) {
      setSaveFolderId(matchedSubjectId);
    }
  }, [matchedSubjectId, saveFolderId, creatingFolder]);

  function closeCardModal() {
    setCardSource(null);
    setDraftCards(null);
    setMakingCards(false);
    setSaving(false);
    setCreatingFolder(false);
    setFolderName('');
    setFolderIcon('📚');
    setSaveFolderId(matchedSubjectId);
  }

  async function send() {
    const text = input.trim();
    if (!text) {
      showToast('Type a question first');
      return;
    }
    if (busy) return;

    setInput('');
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await api.askTutor(text, subject, history);
      const allowFlashcards =
        res.allow_flashcards ?? isFlashcardWorthyTutorReply(res.reply);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.reply,
          allowFlashcards,
        },
      ]);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'I could not answer that just now. Please try asking again in a moment.',
          allowFlashcards: false,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function startFlashcardsFromReply(reply: string, messageIndex: number) {
    if (makingCards || busy) return;
    const priorUser = [...messages]
      .slice(0, messageIndex)
      .reverse()
      .find((m) => m.role === 'user');

    setCardSource({ reply, question: priorUser?.text });
    setDraftCards(null);
    setMakingCards(true);
    setSaveFolderId(matchedSubjectId);
    try {
      const result = await buildFlashcardsFromTutorReply({
        reply,
        question: priorUser?.text,
        subject,
      });
      if (!result.cards.length) {
        showToast(
          result.aiError
            ? friendlyAiError(result.aiError)
            : 'Could not create flashcards from that reply.',
        );
        closeCardModal();
        return;
      }
      setDraftCards(result.cards);
    } catch (error) {
      showToast(friendlyAiError(error));
      closeCardModal();
    } finally {
      setMakingCards(false);
    }
  }

  async function createFolderInline() {
    const name = folderName.trim();
    if (!name) {
      showToast('Enter a subject name');
      return;
    }
    const created = await createSubject(name, folderIcon);
    setSaveFolderId(created.id);
    setCreatingFolder(false);
    setFolderName('');
  }

  async function onSaveCards() {
    if (!draftCards?.length) return;
    if (saveFolderId == null) {
      showToast('Choose a subject folder first');
      return;
    }
    setSaving(true);
    try {
      const result = await saveDraftFlashcards(saveFolderId, draftCards);
      showToast(result.message);
      closeCardModal();
    } catch {
      showToast('Could not save flashcards. Try again.');
    } finally {
      setSaving(false);
    }
  }

  // Stack header when pushed; tab bar is usually hidden while typing.
  const iosOffset = headerHeight + (tabBarHeight > 0 ? 8 : 12);
  const androidLift =
    keyboardHeight > 0
      ? Math.max(0, keyboardHeight - (keyboardVisible ? 0 : tabBarHeight))
      : 0;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={iosOffset}
      enabled={Platform.OS === 'ios'}
    >
      <View
        style={[
          styles.root,
          Platform.OS === 'android' && androidLift > 0
            ? { paddingBottom: androidLift }
            : null,
        ]}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          <Text style={styles.h1}>✦ AI Tutor</Text>
          <Text style={styles.sub}>
            Ask questions and get direct answers
            {subject ? ` for ${subject}` : ''}.
            {!cloudReady
              ? ' AI is offline on this device right now.'
              : ' AI is ready.'}{' '}
            You can turn answers into flashcards.
          </Text>

          <View style={styles.chat}>
            {messages.map((m, i) => (
              <Card
                key={`${m.role}-${i}`}
                style={[
                  styles.bubble,
                  m.role === 'user' ? styles.userBubble : styles.botBubble,
                ]}
              >
                <Text style={styles.bubbleText}>{m.text}</Text>
                {m.role === 'assistant' && m.allowFlashcards ? (
                  <PrimaryButton
                    label={
                      makingCards && cardSource?.reply === m.text
                        ? 'Creating cards…'
                        : 'Make flashcards'
                    }
                    variant="secondary"
                    onPress={() => void startFlashcardsFromReply(m.text, i)}
                    style={styles.cardAction}
                  />
                ) : null}
              </Card>
            ))}
          </View>
        </ScrollView>

        <View
          style={[
            styles.composer,
            {
              paddingBottom: keyboardVisible
                ? 10
                : Math.max(insets.bottom, 10),
            },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask a study question..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
            editable={!busy}
            onFocus={() => {
              requestAnimationFrame(() => {
                scrollRef.current?.scrollToEnd({ animated: true });
              });
            }}
          />
          <PrimaryButton
            label={busy ? '…' : 'Send'}
            onPress={() => void send()}
            style={{ minWidth: 88, opacity: busy ? 0.7 : 1 }}
          />
        </View>
      </View>

      <AppModal
        visible={!!cardSource}
        onClose={() => {
          if (makingCards || saving) return;
          closeCardModal();
        }}
      >
        <Text style={styles.modalTitle}>
          {makingCards ? 'Creating flashcards…' : 'Flashcards from tutor answer'}
        </Text>
        <Text style={[styles.sub, { marginTop: 8 }]}>
          {makingCards
            ? 'Turning this explanation into exam-review cards.'
            : draftCards
              ? `${draftCards.length} card${draftCards.length === 1 ? '' : 's'} ready to save.`
              : 'Preparing cards…'}
        </Text>

        {draftCards?.[0] ? (
          <View style={styles.sample}>
            <Text style={styles.sampleLabel}>Sample</Text>
            <Text style={styles.sampleTitle}>{draftCards[0].question}</Text>
            <Text style={[styles.sub, { marginTop: 6 }]}>{draftCards[0].answer}</Text>
          </View>
        ) : null}

        {!makingCards && draftCards ? (
          <>
            <Text style={[styles.sub, { marginTop: 16, marginBottom: 8, fontWeight: '700' }]}>
              Save to subject
            </Text>

            {creatingFolder || subjects.length === 0 ? (
              <View>
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
                <View style={styles.subjectChips}>
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
                    onPress={() => void createFolderInline()}
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
                  onPress={() => setCreatingFolder(true)}
                  style={{ marginTop: 10 }}
                />
              </>
            )}

            <View style={[styles.row, { marginTop: 20 }]}>
              <PrimaryButton
                label="Discard"
                variant="secondary"
                onPress={closeCardModal}
                style={styles.flexBtn}
              />
              <PrimaryButton
                label={saving ? 'Saving…' : 'Save flashcards'}
                onPress={() => void onSaveCards()}
                style={{ flex: 1, opacity: saving ? 0.7 : 1 }}
              />
            </View>
          </>
        ) : null}
      </AppModal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  chatScroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, flexGrow: 1 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, marginTop: 6, marginBottom: 18, lineHeight: 20 },
  chat: { gap: 12 },
  bubble: { padding: 16 },
  userBubble: {
    backgroundColor: colors.primarySoft,
    borderColor: '#D9D5FF',
    alignSelf: 'flex-end',
  },
  botBubble: { alignSelf: 'flex-start', maxWidth: '100%' },
  bubbleText: { color: colors.ink, lineHeight: 22, fontSize: 15 },
  cardAction: { marginTop: 12, alignSelf: 'stretch' },
  composer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: '#fff',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sample: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.purpleTint,
  },
  sampleLabel: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sampleTitle: {
    marginTop: 8,
    fontWeight: '800',
    color: colors.ink,
    fontSize: 16,
  },
  subjectChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  chipText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  chipTextActive: { color: colors.primary },
  folderNameInput: { marginTop: 10 },
  row: { flexDirection: 'row', gap: 10 },
  flexBtn: { flex: 1 },
});
