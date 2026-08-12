import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { DraftFlashcard } from '../api/types';
import { colors } from '../theme/colors';
import { PrimaryButton } from './ui';
import {
  cardNeedsReview,
  summarizeDraftQuality,
} from '../storage/draftCardQuality';

export type AiDraftPhase = 'summary' | 'review' | 'save';

type Props = {
  cards: DraftFlashcard[];
  onChangeCards: (cards: DraftFlashcard[]) => void;
  phase: AiDraftPhase;
  onPhaseChange: (phase: AiDraftPhase) => void;
  /** Subject picker + save controls rendered by the parent when phase === 'save'. */
  saveSlot?: React.ReactNode;
  onDiscard: () => void;
  subtitle?: string;
  warning?: string;
};

export function AiDraftReviewFlow({
  cards,
  onChangeCards,
  phase,
  onPhaseChange,
  saveSlot,
  onDiscard,
  subtitle,
  warning,
}: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');

  const quality = useMemo(() => summarizeDraftQuality(cards), [cards]);

  function startEdit(index: number) {
    const card = cards[index];
    if (!card) return;
    setEditingIndex(index);
    setEditQuestion(card.question);
    setEditAnswer(card.answer);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditQuestion('');
    setEditAnswer('');
  }

  function saveEdit() {
    if (editingIndex == null) return;
    const question = editQuestion.trim();
    const answer = editAnswer.trim();
    if (!question || !answer) return;
    onChangeCards(
      cards.map((card, i) =>
        i === editingIndex ? { question, answer } : card,
      ),
    );
    cancelEdit();
  }

  function deleteCard(index: number) {
    const next = cards.filter((_, i) => i !== index);
    onChangeCards(next);
    if (editingIndex === index) cancelEdit();
    else if (editingIndex != null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
    if (next.length === 0) onDiscard();
  }

  if (phase === 'summary') {
    return (
      <View>
        <Text style={styles.h2}>AI generated {quality.total} flashcards</Text>
        {subtitle ? (
          <Text style={[styles.sub, { marginTop: 8 }]}>{subtitle}</Text>
        ) : null}
        {warning ? (
          <Text style={[styles.sub, { marginTop: 8, color: '#B45309' }]}>
            {warning}
          </Text>
        ) : null}

        <View style={styles.qualityBox}>
          <Text style={styles.qualityGood}>✓ {quality.good} look good</Text>
          <Text style={styles.qualityWarn}>
            ⚠ {quality.needsReview} need review
          </Text>
        </View>

        <View style={styles.row}>
          <PrimaryButton
            label="Review Cards"
            variant="secondary"
            onPress={() => onPhaseChange('review')}
            style={styles.flexBtn}
          />
          <PrimaryButton
            label="Save All"
            onPress={() => onPhaseChange('save')}
            style={styles.flexBtn}
          />
        </View>
        <PrimaryButton
          label="Discard"
          variant="secondary"
          onPress={onDiscard}
          style={{ marginTop: 10 }}
        />
      </View>
    );
  }

  if (phase === 'review') {
    return (
      <View>
        <Text style={styles.h2}>Review cards</Text>
        <Text style={[styles.sub, { marginTop: 8, marginBottom: 12 }]}>
          Edit or delete anything that looks off before saving. {quality.needsReview}{' '}
          flagged for review.
        </Text>

        {cards.map((card, index) => {
          const flagged = cardNeedsReview(card);
          const editing = editingIndex === index;
          return (
            <View
              key={`${index}-${card.question.slice(0, 24)}`}
              style={[styles.cardItem, flagged && styles.cardItemFlagged]}
            >
              {flagged ? (
                <Text style={styles.flagLabel}>⚠ Needs review</Text>
              ) : (
                <Text style={styles.okLabel}>✓ Looks good</Text>
              )}

              {editing ? (
                <>
                  <Text style={styles.fieldLabel}>Question:</Text>
                  <TextInput
                    value={editQuestion}
                    onChangeText={setEditQuestion}
                    multiline
                    style={[styles.input, styles.inputMultiline]}
                    placeholderTextColor={colors.muted}
                  />
                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                    Answer:
                  </Text>
                  <TextInput
                    value={editAnswer}
                    onChangeText={setEditAnswer}
                    multiline
                    style={[styles.input, styles.inputMultilineTall]}
                    placeholderTextColor={colors.muted}
                  />
                  <View style={styles.row}>
                    <PrimaryButton
                      label="Cancel"
                      variant="secondary"
                      onPress={cancelEdit}
                      style={styles.flexBtn}
                    />
                    <PrimaryButton
                      label="Save edits"
                      onPress={saveEdit}
                      style={styles.flexBtn}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Question:</Text>
                  <Text style={styles.cardQuestion}>{card.question}</Text>
                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                    Answer:
                  </Text>
                  <Text style={styles.cardAnswer}>{card.answer}</Text>
                  <View style={styles.row}>
                    <PrimaryButton
                      label="Edit"
                      variant="secondary"
                      onPress={() => startEdit(index)}
                      style={styles.flexBtn}
                    />
                    <PrimaryButton
                      label="Delete"
                      variant="danger"
                      onPress={() => deleteCard(index)}
                      style={styles.flexBtn}
                    />
                  </View>
                </>
              )}
            </View>
          );
        })}

        <View style={styles.row}>
          <PrimaryButton
            label="Back"
            variant="secondary"
            onPress={() => {
              cancelEdit();
              onPhaseChange('summary');
            }}
            style={styles.flexBtn}
          />
          <PrimaryButton
            label="Continue to save"
            onPress={() => {
              cancelEdit();
              onPhaseChange('save');
            }}
            style={styles.flexBtn}
          />
        </View>
      </View>
    );
  }

  // save phase
  return (
    <View>
      <Text style={styles.h2}>Save flashcards</Text>
      <Text style={[styles.sub, { marginTop: 8 }]}>
        {cards.length} card{cards.length === 1 ? '' : 's'} ready to save
        {quality.needsReview > 0
          ? ` · ${quality.needsReview} still flagged`
          : ''}
        .
      </Text>
      <Pressable
        onPress={() => onPhaseChange('review')}
        style={styles.linkRow}
      >
        <Text style={styles.linkText}>← Back to review</Text>
      </Pressable>
      {saveSlot}
    </View>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 20, fontWeight: '800', color: colors.ink, margin: 0 },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  qualityBox: {
    marginTop: 14,
    backgroundColor: '#F7F6FF',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  qualityGood: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 15,
  },
  qualityWarn: {
    color: '#B45309',
    fontWeight: '700',
    fontSize: 15,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  flexBtn: { flex: 1 },
  cardItem: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  cardItemFlagged: {
    borderColor: '#F0C58B',
    backgroundColor: colors.warningSoft,
  },
  flagLabel: {
    color: '#B45309',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 8,
  },
  okLabel: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 8,
  },
  fieldLabel: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  cardQuestion: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 21,
  },
  cardAnswer: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: colors.ink,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  inputMultilineTall: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  linkRow: { marginTop: 12, marginBottom: 4 },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
