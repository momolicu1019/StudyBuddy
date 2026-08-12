import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { DraftFlashcard, Subject } from '../api/types';
import {
  Card,
  IconBubble,
  PrimaryButton,
  SearchInput,
} from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'TypeNotes'>;

type WizardStep = 'subject' | 'options' | 'cards';

export type CardStyle =
  | 'basic_qa'
  | 'definition'
  | 'fill_blank'
  | 'true_false'
  | 'multiple_choice';

type TypedCardDraft = {
  front: string;
  back: string;
  options: [string, string, string, string];
  correctIndex: number;
  trueFalse: 'true' | 'false' | null;
};

const SUGGESTED_SUBJECTS = [
  { name: 'Biology', icon: '🧬' },
  { name: 'Mathematics', icon: '➗' },
  { name: 'English', icon: '📖' },
  { name: 'Science', icon: '🔬' },
] as const;

const CARD_COUNTS = [10, 20, 30, 50] as const;

const CARD_STYLES: { id: CardStyle; label: string; hint: string }[] = [
  { id: 'basic_qa', label: 'Basic Q&A', hint: 'Question on front, answer on back' },
  { id: 'definition', label: 'Definition', hint: 'Term + explanation' },
  {
    id: 'fill_blank',
    label: 'Fill in the blank',
    hint: 'Sentence with a blank + the missing word',
  },
  { id: 'true_false', label: 'True/False', hint: 'Statement + true or false' },
  {
    id: 'multiple_choice',
    label: 'Multiple choice',
    hint: 'Question with four options',
  },
];

const FOLDER_ICONS = ['📚', '🧬', '🔬', '➗', '🌎', '📖', '💻', '🎨'];

function emptyCard(): TypedCardDraft {
  return {
    front: '',
    back: '',
    options: ['', '', '', ''],
    correctIndex: 0,
    trueFalse: null,
  };
}

function fieldLabels(style: CardStyle): { front: string; back: string } {
  switch (style) {
    case 'basic_qa':
      return { front: 'Keypoint name / Question', back: 'Explanation / Answer' };
    case 'definition':
      return { front: 'Term / Keypoint name', back: 'Definition / Explanation' };
    case 'fill_blank':
      return {
        front: 'Sentence (use _____ for the blank)',
        back: 'Answer for the blank',
      };
    case 'true_false':
      return { front: 'Statement', back: 'True or False' };
    case 'multiple_choice':
      return { front: 'Question', back: 'Correct answer' };
  }
}

function toDraftFlashcard(card: TypedCardDraft, style: CardStyle): DraftFlashcard | null {
  const front = card.front.trim();
  if (!front) return null;

  if (style === 'true_false') {
    if (!card.trueFalse) return null;
    return {
      question: front,
      answer: card.trueFalse === 'true' ? 'True' : 'False',
    };
  }

  if (style === 'multiple_choice') {
    const options = card.options.map((o) => o.trim());
    if (options.some((o) => !o)) return null;
    const letters = ['A', 'B', 'C', 'D'] as const;
    const correct = options[card.correctIndex];
    const listed = options
      .map((opt, i) => `${letters[i]}) ${opt}`)
      .join('\n');
    return {
      question: front,
      answer: `Correct: ${letters[card.correctIndex]}) ${correct}\n${listed}`,
    };
  }

  const back = card.back.trim();
  if (!back) return null;
  return { question: front, answer: back };
}

export function TypeNotesScreen({ navigation }: Props) {
  const { subjects, showToast, createSubject, saveDraftFlashcards } = useApp();

  const [step, setStep] = useState<WizardStep>('subject');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderIcon, setFolderIcon] = useState('📚');

  const [cardCountPreset, setCardCountPreset] = useState<number | 'custom'>(10);
  const [customCount, setCustomCount] = useState('15');
  const [cardStyle, setCardStyle] = useState<CardStyle>('basic_qa');

  const [cards, setCards] = useState<TypedCardDraft[]>(() =>
    Array.from({ length: 10 }, emptyCard),
  );
  const [cardIndex, setCardIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const selectedSubject: Subject | undefined = subjects.find((s) => s.id === subjectId);
  const labels = fieldLabels(cardStyle);

  const resolvedCount = useMemo(() => {
    if (cardCountPreset === 'custom') {
      const n = Number.parseInt(customCount, 10);
      if (!Number.isFinite(n) || n < 1) return 1;
      return Math.min(100, n);
    }
    return cardCountPreset;
  }, [cardCountPreset, customCount]);

  async function ensureSuggestedSubject(name: string, icon: string) {
    const existing = subjects.find(
      (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      setSubjectId(existing.id);
      setCreatingFolder(false);
      return;
    }
    const created = await createSubject(name, icon);
    setSubjectId(created.id);
    setCreatingFolder(false);
  }

  function startCreateFolder() {
    setFolderName('');
    setFolderIcon('📚');
    setCreatingFolder(true);
  }

  async function createFolderInline() {
    const name = folderName.trim();
    if (!name) {
      showToast('Please enter a subject name');
      return;
    }
    const created = await createSubject(name, folderIcon);
    setSubjectId(created.id);
    setCreatingFolder(false);
    setFolderName('');
    setFolderIcon('📚');
  }

  function goToOptions() {
    if (!subjectId) {
      showToast('Choose a subject first');
      return;
    }
    setStep('options');
  }

  function goToCards() {
    if (cardCountPreset === 'custom') {
      const n = Number.parseInt(customCount, 10);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        showToast('Enter a custom count between 1 and 100');
        return;
      }
    }
    const count = resolvedCount;
    setCards((prev) => {
      if (prev.length === count) return prev;
      if (prev.length < count) {
        return [
          ...prev,
          ...Array.from({ length: count - prev.length }, emptyCard),
        ];
      }
      return prev.slice(0, count);
    });
    setCardIndex(0);
    setStep('cards');
  }

  function updateCurrentCard(patch: Partial<TypedCardDraft>) {
    setCards((prev) =>
      prev.map((card, i) => (i === cardIndex ? { ...card, ...patch } : card)),
    );
  }

  function updateOption(optionIndex: number, value: string) {
    setCards((prev) =>
      prev.map((card, i) => {
        if (i !== cardIndex) return card;
        const options = [...card.options] as TypedCardDraft['options'];
        options[optionIndex] = value;
        return { ...card, options };
      }),
    );
  }

  async function onSave() {
    if (!subjectId || saving) return;

    const drafts: DraftFlashcard[] = [];
    for (const card of cards) {
      const draft = toDraftFlashcard(card, cardStyle);
      if (draft) drafts.push(draft);
    }

    if (drafts.length === 0) {
      showToast('Fill in at least one complete card');
      return;
    }

    setSaving(true);
    try {
      const result = await saveDraftFlashcards(subjectId, drafts, {
        preserveContent: true,
      });
      showToast(result.message);
      navigation.replace('Study', { subjectId });
    } catch {
      showToast('Could not save flashcards. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const current = cards[cardIndex] ?? emptyCard();
  const filledCount = cards.filter((c) => toDraftFlashcard(c, cardStyle)).length;

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
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <IconBubble size={54}>✍️</IconBubble>
          <Text style={styles.h1}>Type Notes</Text>
          <Text style={[styles.sub, styles.heroSub]}>
            Build flashcards yourself — no AI needed. Choose a subject, set your
            deck size and style, then type each card.
          </Text>
        </View>

        <View style={styles.steps}>
          {(['subject', 'options', 'cards'] as WizardStep[]).map((s, i) => {
            const labelsMap = {
              subject: 'Subject',
              options: 'Setup',
              cards: 'Type',
            };
            const active = step === s;
            const done =
              (s === 'subject' && (step === 'options' || step === 'cards')) ||
              (s === 'options' && step === 'cards');
            return (
              <View key={s} style={[styles.stepPill, (active || done) && styles.stepPillOn]}>
                <Text style={[styles.stepPillText, (active || done) && styles.stepPillTextOn]}>
                  {i + 1}. {labelsMap[s]}
                </Text>
              </View>
            );
          })}
        </View>

        {step === 'subject' ? (
          <Card>
            <Text style={styles.h2}>Choose Subject</Text>
            <Text style={[styles.sub, { marginTop: 6, marginBottom: 14 }]}>
              Pick a folder for these flashcards.
            </Text>

            <Text style={styles.sectionLabel}>Quick picks</Text>
            <View style={styles.chips}>
              {SUGGESTED_SUBJECTS.map((s) => {
                const match = subjects.find(
                  (sub) =>
                    sub.name.trim().toLowerCase() === s.name.toLowerCase(),
                );
                const active = match != null && subjectId === match.id;
                return (
                  <Pressable
                    key={s.name}
                    onPress={() => void ensureSuggestedSubject(s.name, s.icon)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {s.icon} {s.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {subjects.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
                  Your subjects
                </Text>
                <View style={styles.chips}>
                  {subjects.map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        setSubjectId(s.id);
                        setCreatingFolder(false);
                      }}
                      style={[styles.chip, subjectId === s.id && styles.chipActive]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          subjectId === s.id && styles.chipTextActive,
                        ]}
                      >
                        {s.icon} {s.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {creatingFolder ? (
              <View style={styles.inlineCreate}>
                <Text style={styles.sub}>Name your new subject.</Text>
                <SearchInput
                  value={folderName}
                  onChangeText={setFolderName}
                  placeholder="e.g. Chemistry"
                  style={styles.folderNameInput}
                />
                <View style={[styles.chips, { marginTop: 12 }]}>
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
                <View style={styles.row}>
                  <PrimaryButton
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setCreatingFolder(false)}
                    style={styles.flexBtn}
                  />
                  <PrimaryButton
                    label="Create subject"
                    onPress={() => void createFolderInline()}
                    style={styles.flexBtn}
                  />
                </View>
              </View>
            ) : (
              <PrimaryButton
                label="+ New Subject"
                variant="secondary"
                onPress={startCreateFolder}
                style={{ marginTop: 16 }}
              />
            )}

            <PrimaryButton
              label="Continue"
              onPress={goToOptions}
              style={{ marginTop: 18, opacity: subjectId ? 1 : 0.55 }}
            />
          </Card>
        ) : null}

        {step === 'options' ? (
          <Card>
            <Text style={styles.h2}>Deck setup</Text>
            <Text style={[styles.sub, { marginTop: 6 }]}>
              Saving to {selectedSubject?.icon} {selectedSubject?.name}
            </Text>

            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
              Number of cards
            </Text>
            <View style={styles.chips}>
              {CARD_COUNTS.map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setCardCountPreset(n)}
                  style={[
                    styles.chip,
                    cardCountPreset === n && styles.chipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      cardCountPreset === n && styles.chipTextActive,
                    ]}
                  >
                    {n}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setCardCountPreset('custom')}
                style={[
                  styles.chip,
                  cardCountPreset === 'custom' && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    cardCountPreset === 'custom' && styles.chipTextActive,
                  ]}
                >
                  Custom
                </Text>
              </Pressable>
            </View>
            {cardCountPreset === 'custom' ? (
              <TextInput
                value={customCount}
                onChangeText={setCustomCount}
                keyboardType="number-pad"
                placeholder="e.g. 15"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            ) : null}

            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
              Card style
            </Text>
            <View style={styles.styleList}>
              {CARD_STYLES.map((style) => {
                const active = cardStyle === style.id;
                return (
                  <Pressable
                    key={style.id}
                    onPress={() => setCardStyle(style.id)}
                    style={[styles.styleRow, active && styles.styleRowActive]}
                  >
                    <Text
                      style={[styles.styleTitle, active && styles.chipTextActive]}
                    >
                      {style.label}
                    </Text>
                    <Text style={styles.sub}>{style.hint}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.row}>
              <PrimaryButton
                label="Back"
                variant="secondary"
                onPress={() => setStep('subject')}
                style={styles.flexBtn}
              />
              <PrimaryButton
                label="Start typing"
                onPress={goToCards}
                style={styles.flexBtn}
              />
            </View>
          </Card>
        ) : null}

        {step === 'cards' ? (
          <Card>
            <Text style={styles.h2}>
              Card {cardIndex + 1} of {cards.length}
            </Text>
            <Text style={[styles.sub, { marginTop: 6, marginBottom: 14 }]}>
              {CARD_STYLES.find((s) => s.id === cardStyle)?.label} · {filledCount}{' '}
              filled
            </Text>

            <Text style={styles.fieldLabel}>{labels.front}</Text>
            <TextInput
              value={current.front}
              onChangeText={(front) => updateCurrentCard({ front })}
              placeholder={
                cardStyle === 'fill_blank'
                  ? 'e.g. The powerhouse of the cell is the _____.'
                  : cardStyle === 'true_false'
                    ? 'e.g. Mitochondria produce ATP.'
                    : 'e.g. Mitochondria'
              }
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, styles.inputMultiline]}
            />

            {cardStyle === 'true_false' ? (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                  {labels.back}
                </Text>
                <View style={styles.chips}>
                  {(['true', 'false'] as const).map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => updateCurrentCard({ trueFalse: v })}
                      style={[
                        styles.chip,
                        current.trueFalse === v && styles.chipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          current.trueFalse === v && styles.chipTextActive,
                        ]}
                      >
                        {v === 'true' ? 'True' : 'False'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {cardStyle === 'multiple_choice' ? (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                  Options
                </Text>
                {current.options.map((opt, i) => (
                  <View key={i} style={styles.optionRow}>
                    <Pressable
                      onPress={() => updateCurrentCard({ correctIndex: i })}
                      style={[
                        styles.correctDot,
                        current.correctIndex === i && styles.correctDotOn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.correctDotText,
                          current.correctIndex === i && styles.correctDotTextOn,
                        ]}
                      >
                        {String.fromCharCode(65 + i)}
                      </Text>
                    </Pressable>
                    <TextInput
                      value={opt}
                      onChangeText={(value) => updateOption(i, value)}
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.optionInput]}
                    />
                  </View>
                ))}
                <Text style={[styles.sub, { marginTop: 8 }]}>
                  Tap A–D to mark the correct answer.
                </Text>
              </>
            ) : null}

            {cardStyle !== 'true_false' && cardStyle !== 'multiple_choice' ? (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                  {labels.back}
                </Text>
                <TextInput
                  value={current.back}
                  onChangeText={(back) => updateCurrentCard({ back })}
                  placeholder="Type the explanation or answer"
                  placeholderTextColor={colors.muted}
                  multiline
                  style={[styles.input, styles.inputMultilineTall]}
                />
              </>
            ) : null}

            <View style={styles.row}>
              <PrimaryButton
                label="Previous"
                variant="secondary"
                onPress={() => setCardIndex((i) => Math.max(0, i - 1))}
                style={{
                  flex: 1,
                  opacity: cardIndex === 0 ? 0.45 : 1,
                }}
              />
              {cardIndex < cards.length - 1 ? (
                <PrimaryButton
                  label="Next card"
                  onPress={() =>
                    setCardIndex((i) => Math.min(cards.length - 1, i + 1))
                  }
                  style={styles.flexBtn}
                />
              ) : (
                <PrimaryButton
                  label={saving ? 'Saving…' : 'Save flashcards'}
                  onPress={() => void onSave()}
                  style={styles.flexBtn}
                />
              )}
            </View>

            {cardIndex < cards.length - 1 ? (
              <PrimaryButton
                label={
                  saving
                    ? 'Saving…'
                    : `Save ${filledCount} card${filledCount === 1 ? '' : 's'} now`
                }
                variant="secondary"
                onPress={() => void onSave()}
                style={{ marginTop: 10 }}
              />
            ) : null}

            <PrimaryButton
              label="Back to setup"
              variant="secondary"
              onPress={() => setStep('options')}
              style={{ marginTop: 10 }}
            />
          </Card>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', marginBottom: 16 },
  h1: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.ink,
    marginTop: 10,
    textAlign: 'center',
  },
  heroSub: { textAlign: 'center', marginTop: 6 },
  h2: { fontSize: 20, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  steps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
    justifyContent: 'center',
  },
  stepPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stepPillOn: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  stepPillText: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  stepPillTextOn: { color: colors.primary },
  sectionLabel: {
    color: colors.ink,
    fontWeight: '700',
    marginBottom: 8,
    fontSize: 14,
  },
  fieldLabel: {
    color: colors.ink,
    fontWeight: '700',
    marginBottom: 8,
    fontSize: 14,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  inlineCreate: {
    marginTop: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D7D5E7',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  folderNameInput: {
    marginTop: 12,
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 52,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  flexBtn: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    backgroundColor: '#fff',
    color: colors.ink,
    fontSize: 16,
    marginTop: 10,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
    marginTop: 0,
  },
  inputMultilineTall: {
    minHeight: 120,
    textAlignVertical: 'top',
    marginTop: 0,
  },
  styleList: { gap: 8 },
  styleRow: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  styleRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  styleTitle: {
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 2,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  optionInput: { flex: 1, marginTop: 0 },
  correctDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  correctDotOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  correctDotText: { fontWeight: '800', color: colors.muted },
  correctDotTextOn: { color: '#fff' },
});
