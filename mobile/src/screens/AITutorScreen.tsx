import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import type { DraftFlashcard } from '../api/types';
import {
  AiDraftReviewFlow,
  type AiDraftPhase,
} from '../components/AiDraftReviewFlow';
import { AppModal, Card, PrimaryButton, SearchInput } from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { buildFlashcardsFromTutorReply } from '../storage/flashcardGenerator';
import { friendlyAiError } from '../storage/geminiClient';
import type { TutorChat } from '../storage/schema';
import {
  isCloudTutorConfigured,
  isFlashcardWorthyTutorReply,
  TUTOR_MODES,
  tutorModeById,
  type TutorMode,
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

function greetingMessage(
  subject: string | undefined,
  cloudReady: boolean,
  mode: TutorMode,
  guideWithoutAnswer: boolean,
): ChatItem {
  const modeMeta = tutorModeById(mode);
  const guideBit = guideWithoutAnswer
    ? ' I will guide you with questions and will not hand you the final answer.'
    : '';
  return {
    role: 'assistant',
    text: subject
      ? `Hi! I'm your AI Tutor for ${subject}. Mode: ${modeMeta.icon} ${modeMeta.label}.${guideBit} Ask a question and I'll help${cloudReady ? '' : ' from your notes'}.`
      : `Hi! I'm your Study Buddy AI Tutor. Pick how you want help below, then ask a question.${guideBit}${cloudReady ? '' : ' AI is offline — I’ll use your flashcards when I can.'}`,
  };
}

function formatChatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

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
  const activeChatIdRef = useRef<number | null>(null);
  const cloudReady = isCloudTutorConfigured();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tutorMode, setTutorMode] = useState<TutorMode>('explain');
  const [guideWithoutAnswer, setGuideWithoutAnswer] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([
    greetingMessage(subject, cloudReady, 'explain', false),
  ]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<TutorChat[]>([]);
  const [deleteChatId, setDeleteChatId] = useState<number | null>(null);

  const [cardSource, setCardSource] = useState<{
    reply: string;
    question?: string;
  } | null>(null);
  const [draftCards, setDraftCards] = useState<DraftFlashcard[] | null>(null);
  const [draftPhase, setDraftPhase] = useState<AiDraftPhase>('summary');
  const [makingCards, setMakingCards] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFolderId, setSaveFolderId] = useState<number | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('📚');

  activeChatIdRef.current = activeChatId;

  const matchedSubjectId = useMemo(() => {
    if (!subject) return subjects[0]?.id ?? null;
    return (
      subjects.find((s) => s.name.toLowerCase() === subject.trim().toLowerCase())
        ?.id ??
      subjects[0]?.id ??
      null
    );
  }, [subject, subjects]);

  const pendingDelete = chatHistory.find((c) => c.id === deleteChatId) ?? null;

  const loadHistory = useCallback(async () => {
    try {
      const list = await api.getTutorChats();
      setChatHistory(list);
    } catch {
      setChatHistory([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory]),
  );

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
    setDraftPhase('summary');
    setMakingCards(false);
    setSaving(false);
    setCreatingFolder(false);
    setFolderName('');
    setFolderIcon('📚');
    setSaveFolderId(matchedSubjectId);
  }

  const activeMode = tutorModeById(tutorMode);

  function startNewChat() {
    if (busy) return;
    setActiveChatId(null);
    setMessages([
      greetingMessage(subject, cloudReady, tutorMode, guideWithoutAnswer),
    ]);
    setInput('');
    setHistoryOpen(false);
    showToast('Started a new chat');
  }

  function selectMode(mode: TutorMode) {
    setTutorMode(mode);
    // Refresh greeting only when still on the initial empty chat.
    setMessages((prev) => {
      if (prev.length === 1 && prev[0]?.role === 'assistant' && activeChatId == null) {
        return [
          greetingMessage(subject, cloudReady, mode, guideWithoutAnswer),
        ];
      }
      return prev;
    });
  }

  function toggleGuideWithoutAnswer() {
    setGuideWithoutAnswer((prev) => {
      const next = !prev;
      setMessages((msgs) => {
        if (msgs.length === 1 && msgs[0]?.role === 'assistant' && activeChatId == null) {
          return [greetingMessage(subject, cloudReady, tutorMode, next)];
        }
        return msgs;
      });
      return next;
    });
  }

  async function openHistoryChat(chat: TutorChat) {
    if (busy) return;
    try {
      const fresh = await api.getTutorChat(chat.id);
      setActiveChatId(fresh.id);
      setMessages(
        fresh.messages.map((m) => ({
          role: m.role,
          text: m.text,
          allowFlashcards: m.allow_flashcards,
        })),
      );
      setHistoryOpen(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: false });
      });
    } catch {
      showToast('Could not open that chat');
      await loadHistory();
    }
  }

  async function confirmDeleteChat() {
    if (deleteChatId == null) return;
    const id = deleteChatId;
    try {
      await api.deleteTutorChat(id);
      if (activeChatIdRef.current === id) {
        setActiveChatId(null);
        setMessages([
          greetingMessage(subject, cloudReady, tutorMode, guideWithoutAnswer),
        ]);
      }
      setDeleteChatId(null);
      await loadHistory();
      showToast('Chat deleted');
    } catch {
      showToast('Could not delete chat');
    }
  }

  async function persistTurn(
    userText: string,
    assistantText: string,
    allowFlashcards: boolean,
  ) {
    const payload = [
      { role: 'user' as const, text: userText },
      {
        role: 'assistant' as const,
        text: assistantText,
        allow_flashcards: allowFlashcards,
      },
    ];

    try {
      if (activeChatIdRef.current == null) {
        const created = await api.createTutorChat({
          subject,
          messages: payload,
        });
        setActiveChatId(created.id);
      } else {
        await api.appendTutorChatMessages(activeChatIdRef.current, payload);
      }
      await loadHistory();
    } catch {
      showToast('Could not save this chat');
    }
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
      const res = await api.askTutor(text, subject, history, {
        mode: tutorMode,
        guideWithoutAnswer,
      });
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
      await persistTurn(text, res.reply, allowFlashcards);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    } catch {
      const fallback =
        'I could not answer that just now. Please try asking again in a moment.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: fallback,
          allowFlashcards: false,
        },
      ]);
      await persistTurn(text, fallback, false);
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
      setDraftPhase('summary');
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
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h1}>✨ AI Tutor</Text>
              <Text style={styles.sub}>
                What would you like help with?
                {subject ? ` (${subject})` : ''}
                {!cloudReady ? ' AI is offline on this device right now.' : ''}
              </Text>
            </View>
          </View>

          <Text style={styles.modeHeading}>Help modes</Text>
          <View style={styles.modeChips}>
            {TUTOR_MODES.map((mode) => {
              const active = tutorMode === mode.id;
              return (
                <Pressable
                  key={mode.id}
                  onPress={() => selectMode(mode.id)}
                  style={[styles.modeChip, active && styles.modeChipActive]}
                >
                  <Text
                    style={[
                      styles.modeChipText,
                      active && styles.modeChipTextActive,
                    ]}
                  >
                    {mode.icon} {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.modeBlurb}>{activeMode.blurb}</Text>

          <Pressable
            onPress={toggleGuideWithoutAnswer}
            style={[
              styles.guideToggle,
              guideWithoutAnswer && styles.guideToggleOn,
            ]}
          >
            <Text
              style={[
                styles.guideToggleTitle,
                guideWithoutAnswer && styles.guideToggleTitleOn,
              ]}
            >
              🚫 Don’t give me the answer
            </Text>
            <Text style={styles.guideToggleSub}>
              {guideWithoutAnswer
                ? 'On — I’ll guide you with questions instead of solving it for you.'
                : 'Off — turn on to learn by thinking, not copying answers.'}
            </Text>
          </Pressable>

          <View style={styles.toolbar}>
            <PrimaryButton
              label="History"
              variant="secondary"
              onPress={() => {
                void loadHistory();
                setHistoryOpen(true);
              }}
              style={styles.toolbarBtn}
            />
            <PrimaryButton
              label="New chat"
              variant="secondary"
              onPress={startNewChat}
              style={styles.toolbarBtn}
            />
          </View>

          {activeChatId != null ? (
            <Text style={styles.continuingHint}>
              Continuing a saved chat — ask another question anytime.
            </Text>
          ) : null}

          <View style={styles.chat}>
            {messages.map((m, i) => (
              <Card
                key={`${activeChatId ?? 'new'}-${m.role}-${i}`}
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
            placeholder={activeMode.placeholder}
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
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <Text style={styles.modalTitle}>Chat history</Text>
        <Text style={[styles.sub, { marginTop: 8, marginBottom: 12 }]}>
          Reopen a past conversation or continue where you left off.
        </Text>

        <PrimaryButton
          label="+ Start new chat"
          onPress={startNewChat}
          style={{ marginBottom: 14 }}
        />

        {chatHistory.length === 0 ? (
          <Card>
            <Text style={styles.subEmpty}>
              No saved chats yet. Ask a question and it will appear here.
            </Text>
          </Card>
        ) : (
          <View style={styles.historyList}>
            {chatHistory.map((chat) => (
              <View key={chat.id} style={styles.historyRow}>
                <Pressable
                  style={styles.historyMain}
                  onPress={() => void openHistoryChat(chat)}
                >
                  <Text style={styles.historyTitle} numberOfLines={2}>
                    {chat.title}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {chat.subject ? `${chat.subject} · ` : ''}
                    {formatChatWhen(chat.updated_at)}
                    {activeChatId === chat.id ? ' · Open' : ''}
                  </Text>
                </Pressable>
                <PrimaryButton
                  label="Delete"
                  variant="danger"
                  onPress={() => setDeleteChatId(chat.id)}
                  style={styles.historyDelete}
                />
              </View>
            ))}
          </View>
        )}
      </AppModal>

      <AppModal
        visible={deleteChatId !== null}
        onClose={() => setDeleteChatId(null)}
      >
        <Text style={styles.modalTitle}>Delete this chat?</Text>
        <Text style={[styles.sub, { marginTop: 8 }]}>
          {pendingDelete
            ? `Remove “${pendingDelete.title}”? This cannot be undone.`
            : 'This cannot be undone.'}
        </Text>
        <View style={[styles.row, { marginTop: 20 }]}>
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={() => setDeleteChatId(null)}
            style={styles.flexBtn}
          />
          <PrimaryButton
            label="Delete"
            variant="danger"
            onPress={() => void confirmDeleteChat()}
            style={styles.flexBtn}
          />
        </View>
      </AppModal>

      <AppModal
        visible={!!cardSource}
        onClose={() => {
          if (makingCards || saving) return;
          closeCardModal();
        }}
      >
        {makingCards || !draftCards ? (
          <>
            <Text style={styles.modalTitle}>
              {makingCards ? 'Creating flashcards…' : 'Preparing cards…'}
            </Text>
            <Text style={[styles.sub, { marginTop: 8 }]}>
              Turning this explanation into exam-review cards.
            </Text>
          </>
        ) : (
          <AiDraftReviewFlow
            cards={draftCards}
            onChangeCards={(next) => setDraftCards(next)}
            phase={draftPhase}
            onPhaseChange={setDraftPhase}
            onDiscard={closeCardModal}
            subtitle="Review AI cards from this tutor answer before saving."
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
            }
          />
        )}
      </AppModal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  chatScroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, flexGrow: 1 },
  headerRow: { marginBottom: 4 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, marginTop: 6, marginBottom: 18, lineHeight: 20 },
  modeHeading: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 8,
  },
  modeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  modeChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  modeChipText: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  modeChipTextActive: { color: colors.primary },
  modeBlurb: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  guideToggle: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  guideToggleOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  guideToggleTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
  },
  guideToggleTitleOn: { color: colors.primary },
  guideToggleSub: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  subEmpty: { color: colors.muted, lineHeight: 20, marginBottom: 0 },
  toolbar: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  toolbarBtn: { flex: 1 },
  continuingHint: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 12,
  },
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
  historyList: { gap: 10 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 12,
  },
  historyMain: { flex: 1 },
  historyTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
    lineHeight: 20,
  },
  historyMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  historyDelete: { minWidth: 84 },
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
