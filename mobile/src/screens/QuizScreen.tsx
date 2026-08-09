import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { api } from '../api/client';
import type { QuizQuestion, QuizResult } from '../api/types';
import { Card, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { QUIZ_SIZE } from '../storage/quizBuilder';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Quiz'>;
type Phase = 'select' | 'quiz' | 'results';

export function QuizScreen({ route, navigation }: Props) {
  const { subjects, showToast, refresh } = useApp();
  const routeSubjectId = route.params?.subjectId;

  const [phase, setPhase] = useState<Phase>('select');
  const [selectedIds, setSelectedIds] = useState<number[]>(
    routeSubjectId ? [routeSubjectId] : [],
  );
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedSubjects = useMemo(
    () => subjects.filter((s) => selectedIds.includes(s.id)),
    [subjects, selectedIds],
  );

  const availableCards = useMemo(
    () => selectedSubjects.reduce((sum, s) => sum + s.cards, 0),
    [selectedSubjects],
  );

  useEffect(() => {
    if (routeSubjectId && subjects.some((s) => s.id === routeSubjectId)) {
      setSelectedIds([routeSubjectId]);
    }
  }, [routeSubjectId, subjects]);

  function toggleSubject(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function startQuiz() {
    if (!selectedIds.length) {
      showToast('Select at least one subject folder');
      return;
    }
    if (availableCards < 1) {
      showToast('Selected folders have no flashcards yet');
      return;
    }

    setLoading(true);
    setResult(null);
    setAnswers({});
    setIndex(0);
    try {
      const data = await api.getQuiz(selectedIds);
      if (!data.length) {
        showToast('No quiz questions could be generated');
        return;
      }
      setQuestions(data);
      setPhase('quiz');
    } catch {
      showToast('Could not start quiz. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (Object.keys(answers).length < questions.length) {
      showToast('Answer every question first');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitQuiz(selectedIds, answers, questions);
      setResult(res);
      setPhase('results');
      await refresh();
    } catch {
      showToast('Could not submit quiz. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetToSelect() {
    setPhase('select');
    setQuestions([]);
    setAnswers({});
    setIndex(0);
    setResult(null);
  }

  if (!subjects.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.h2}>Create a subject first</Text>
        <Text style={[styles.sub, { textAlign: 'center', marginVertical: 10 }]}>
          Make a subject folder, generate flashcards, then come back to quiz.
        </Text>
        <PrimaryButton
          label="Go to Flashcards"
          onPress={() => navigation.navigate('Flashcards')}
          style={{ marginTop: 12 }}
        />
      </View>
    );
  }

  if (phase === 'results' && result) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Quiz summary</Text>
        <Text style={styles.score}>{result.percentage}%</Text>
        <Text style={styles.h2}>
          {result.score}/{result.total} correct
        </Text>
        <Text style={[styles.sub, { marginTop: 8, marginBottom: 18 }]}>
          {result.message}
        </Text>

        {result.reviews.map((review, reviewIndex) => {
          const correct = review.is_correct;
          return (
            <Card
              key={`${review.id}-${reviewIndex}`}
              style={[
                styles.reviewCard,
                correct ? styles.reviewCorrect : styles.reviewWrong,
              ]}
            >
              <Text style={styles.reviewLabel}>
                Question {reviewIndex + 1} · {correct ? 'Correct' : 'Incorrect'}
              </Text>
              <Text style={styles.reviewQuestion}>{review.question}</Text>

              <View style={{ gap: 8, marginTop: 12 }}>
                {review.options.map((option, optIndex) => {
                  const isSelected = review.selected_index === optIndex;
                  const isCorrectOption = review.correct_index === optIndex;
                  return (
                    <View
                      key={`${review.id}-opt-${optIndex}`}
                      style={[
                        styles.reviewOption,
                        isCorrectOption && styles.reviewOptionCorrect,
                        isSelected && !correct && styles.reviewOptionWrong,
                      ]}
                    >
                      <Text
                        style={[
                          styles.reviewOptionText,
                          isCorrectOption && styles.reviewOptionTextCorrect,
                          isSelected && !correct && styles.reviewOptionTextWrong,
                        ]}
                      >
                        {option}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {!correct ? (
                <Text style={styles.correctAnswerLine}>
                  Correct answer is {review.correct_answer}
                </Text>
              ) : null}
            </Card>
          );
        })}

        <View style={[styles.row, { marginTop: 8 }]}>
          <PrimaryButton
            label="Retake quiz"
            onPress={() => void startQuiz()}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="Choose subjects"
            variant="secondary"
            onPress={resetToSelect}
            style={{ flex: 1 }}
          />
        </View>
        <PrimaryButton
          label="Study flashcards"
          variant="secondary"
          onPress={() =>
            navigation.navigate('Study', {
              subjectId: selectedIds[0] ?? subjects[0].id,
            })
          }
          style={{ marginTop: 10, marginBottom: 20 }}
        />
      </ScrollView>
    );
  }

  if (phase === 'quiz' && questions.length) {
    const q = questions[index];
    const answeredCount = Object.keys(answers).length;

    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>
          🧠 Quiz Mode ·{' '}
          {selectedSubjects.map((s) => `${s.icon} ${s.name}`).join(' · ')}
        </Text>
        <Text style={styles.progress}>
          Question {index + 1} of {questions.length}
          {answeredCount < questions.length
            ? ` · ${answeredCount}/${questions.length} answered`
            : ' · all answered'}
        </Text>

        <Card>
          <Text style={styles.question}>{q.question}</Text>
          <View style={{ gap: 10, marginTop: 18 }}>
            {q.options.map((option, optIndex) => {
              const selected = answers[q.id] === optIndex;
              return (
                <Pressable
                  key={`${q.id}-${optIndex}`}
                  onPress={() =>
                    setAnswers((prev) => ({ ...prev, [q.id]: optIndex }))
                  }
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text
                    style={[styles.optionText, selected && styles.optionTextSelected]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <View style={styles.row}>
          <PrimaryButton
            label="Previous"
            variant="secondary"
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
            style={{ flex: 1 }}
          />
          {index < questions.length - 1 ? (
            <PrimaryButton
              label="Next"
              onPress={() => {
                if (answers[q.id] === undefined) {
                  showToast('Pick an answer first');
                  return;
                }
                setIndex((i) => i + 1);
              }}
              style={{ flex: 1 }}
            />
          ) : (
            <PrimaryButton
              label={submitting ? 'Submitting…' : 'Submit quiz'}
              onPress={() => void submit()}
              style={{ flex: 1, opacity: submitting ? 0.7 : 1 }}
            />
          )}
        </View>
        <PrimaryButton
          label="Cancel quiz"
          variant="secondary"
          onPress={resetToSelect}
          style={{ marginTop: 10 }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>🧠 Quiz Mode</Text>
      <Text style={[styles.sub, { marginBottom: 16 }]}>
        Select one or more subject folders. We’ll pull up to {QUIZ_SIZE} random
        multiple-choice questions from their flashcards.
      </Text>

      <View style={styles.subjectList}>
        {subjects.map((s) => {
          const selected = selectedIds.includes(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() => toggleSubject(s.id)}
              style={[styles.subjectChip, selected && styles.subjectChipActive]}
            >
              <Text
                style={[
                  styles.subjectChipText,
                  selected && styles.subjectChipTextActive,
                ]}
              >
                {s.icon} {s.name}
              </Text>
              <Text style={[styles.sub, selected && { color: colors.primary }]}>
                {s.cards} cards
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Card style={{ marginTop: 16 }}>
        <Text style={styles.summaryLine}>
          {selectedIds.length
            ? `${selectedIds.length} folder${selectedIds.length > 1 ? 's' : ''} · ${availableCards} flashcards available`
            : 'No folders selected yet'}
        </Text>
        <Text style={[styles.sub, { marginTop: 6 }]}>
          {availableCards >= QUIZ_SIZE
            ? `Quiz length: ${QUIZ_SIZE} random questions`
            : availableCards > 0
              ? `Quiz length: ${availableCards} question${availableCards === 1 ? '' : 's'} (add more flashcards for a full ${QUIZ_SIZE})`
              : 'Generate flashcards first to unlock quiz questions'}
        </Text>
      </Card>

      <PrimaryButton
        label={loading ? 'Preparing quiz…' : `Start quiz`}
        onPress={() => void startQuiz()}
        style={{ marginTop: 18, opacity: loading ? 0.7 : 1 }}
      />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink, marginBottom: 6 },
  h2: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  eyebrow: { color: colors.muted, fontWeight: '700', marginBottom: 6 },
  progress: { color: colors.primary, fontWeight: '800', marginBottom: 14 },
  question: { fontSize: 22, fontWeight: '800', color: colors.ink, lineHeight: 30 },
  option: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  optionText: { color: colors.ink, fontWeight: '600' },
  optionTextSelected: { color: colors.primary },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  score: { fontSize: 56, fontWeight: '800', color: colors.primary },
  subjectList: { gap: 10 },
  subjectChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  subjectChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  subjectChipText: { color: colors.ink, fontWeight: '700', fontSize: 16 },
  subjectChipTextActive: { color: colors.primary },
  summaryLine: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  reviewCard: {
    marginBottom: 12,
    borderWidth: 1.5,
  },
  reviewCorrect: {
    borderColor: colors.success,
    backgroundColor: '#F1FBF6',
  },
  reviewWrong: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  reviewLabel: {
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 6,
  },
  reviewQuestion: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 22,
  },
  reviewOption: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  reviewOptionCorrect: {
    borderColor: colors.success,
    backgroundColor: '#E5F7EE',
  },
  reviewOptionWrong: {
    borderColor: colors.danger,
    backgroundColor: '#FFE4E9',
  },
  reviewOptionText: { color: colors.ink, fontWeight: '600' },
  reviewOptionTextCorrect: { color: '#1F7A4D' },
  reviewOptionTextWrong: { color: colors.danger },
  correctAnswerLine: {
    marginTop: 12,
    fontWeight: '800',
    color: '#1F7A4D',
    fontSize: 14,
  },
});
