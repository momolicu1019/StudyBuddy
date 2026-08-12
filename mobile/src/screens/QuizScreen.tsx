import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { api } from '../api/client';
import type { QuizQuestion, QuizResult } from '../api/types';
import { Card, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import {
  QUIZ_COUNTS,
  QUIZ_TYPES,
  quizTypeById,
  type QuizType,
} from '../storage/quizTypes';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Quiz'>;
type Phase = 'select' | 'quiz' | 'results' | 'summary';

type AnswerMap = Record<
  number,
  { selected_index?: number | null; text?: string | null }
>;

function kindLabel(kind: QuizQuestion['kind']): string {
  switch (kind) {
    case 'multiple_choice':
      return 'Multiple choice';
    case 'typed_answer':
      return 'Type the answer';
    case 'true_false':
      return 'True / False';
    case 'fill_blank':
      return 'Fill in the blank';
  }
}

export function QuizScreen({ route, navigation }: Props) {
  const { subjects, showToast, refresh } = useApp();
  const routeSubjectId = route.params?.subjectId;

  const [phase, setPhase] = useState<Phase>('select');
  const [quizType, setQuizType] = useState<QuizType>('multiple_choice');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [selectedIds, setSelectedIds] = useState<number[]>(
    routeSubjectId ? [routeSubjectId] : [],
  );
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
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

  const subjectSummary = selectedSubjects.length
    ? selectedSubjects.map((s) => s.name).join(' · ')
    : 'No subject';

  const activeType = quizTypeById(quizType);

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

  function isAnswered(q: QuizQuestion): boolean {
    const a = answers[q.id];
    if (!a) return false;
    if (q.kind === 'typed_answer' || q.kind === 'fill_blank') {
      return Boolean(String(a.text ?? '').trim());
    }
    return a.selected_index !== undefined && a.selected_index !== null;
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
      showToast(`Creating ${activeType.label.toLowerCase()} quiz with AI…`);
      const data = await api.getQuiz(selectedIds, {
        quizType,
        size: questionCount,
      });
      if (!data.questions.length) {
        showToast(data.error || 'No quiz questions could be generated');
        return;
      }
      setQuestions(data.questions);
      setPhase('quiz');
      if (data.usedAi) {
        showToast(`${data.questions.length} AI questions ready`);
      } else {
        showToast(
          data.error ||
            `${data.questions.length} questions built from your flashcards`,
        );
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Could not start quiz. Try again.';
      showToast(detail);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (questions.some((q) => !isAnswered(q))) {
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

  if ((phase === 'results' || phase === 'summary') && result) {
    const incorrect = result.total - result.score;
    const showingSummary = phase === 'summary';

    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        {!showingSummary ? (
          <>
            <Text style={styles.completeTitle}>🎉 Quiz Complete!</Text>
            <Text style={styles.scoreLine}>
              {result.score} / {result.total}
            </Text>
            <Text style={styles.score}>{result.percentage}%</Text>
            <Text style={[styles.sub, { marginBottom: 16 }]}>{result.message}</Text>

            <View style={styles.statRow}>
              <View style={[styles.statBox, styles.statGood]}>
                <Text style={styles.statLabel}>Correct</Text>
                <Text style={styles.statValue}>{result.score}</Text>
              </View>
              <View style={[styles.statBox, styles.statBad]}>
                <Text style={styles.statLabel}>Incorrect</Text>
                <Text style={styles.statValue}>{incorrect}</Text>
              </View>
            </View>

            {result.topics_to_review.length ? (
              <Card style={{ marginTop: 8, marginBottom: 8 }}>
                <Text style={styles.topicsHeading}>Topics to review:</Text>
                <View style={{ gap: 8, marginTop: 10 }}>
                  {result.topics_to_review.map((topic) => (
                    <Text key={topic} style={styles.topicLine}>
                      🔴 {topic}
                    </Text>
                  ))}
                </View>
              </Card>
            ) : (
              <Card style={{ marginTop: 8, marginBottom: 8 }}>
                <Text style={styles.topicsHeading}>Topics to review:</Text>
                <Text style={[styles.sub, { marginTop: 8 }]}>
                  None — you got every topic right.
                </Text>
              </Card>
            )}

            <View style={[styles.row, { marginTop: 8 }]}>
              <PrimaryButton
                label="Quiz Summary"
                variant="secondary"
                onPress={() => setPhase('summary')}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Try Again"
                onPress={() => void startQuiz()}
                style={{ flex: 1 }}
              />
            </View>
            <PrimaryButton
              label="Choose quiz"
              variant="secondary"
              onPress={resetToSelect}
              style={{ marginTop: 10, marginBottom: 20 }}
            />
          </>
        ) : (
          <>
            <Text style={styles.h1}>Quiz summary</Text>
            <Text style={[styles.sub, { marginBottom: 16 }]}>
              {result.score} correct · {incorrect} incorrect · every question
            </Text>

            {result.reviews.map((review, reviewIndex) => (
              <Card
                key={`${review.id}-${reviewIndex}`}
                style={[
                  styles.reviewCard,
                  review.is_correct ? styles.reviewCorrect : styles.reviewWrong,
                ]}
              >
                <Text style={styles.reviewLabel}>
                  Q{reviewIndex + 1} · {kindLabel(review.kind)} ·{' '}
                  {review.is_correct ? 'Correct' : 'Incorrect'}
                  {review.topic ? ` · ${review.topic}` : ''}
                </Text>
                <Text style={styles.reviewQuestion}>{review.question}</Text>
                <Text
                  style={[
                    styles.yourAnswerLine,
                    review.is_correct
                      ? styles.yourAnswerCorrect
                      : styles.yourAnswerWrong,
                  ]}
                >
                  Your answer: {review.selected_answer ?? '—'}
                </Text>
                {!review.is_correct ? (
                  <Text style={styles.correctAnswerLine}>
                    Correct answer: {review.correct_answer}
                  </Text>
                ) : null}
              </Card>
            ))}

            <View style={[styles.row, { marginTop: 8 }]}>
              <PrimaryButton
                label="Back to results"
                variant="secondary"
                onPress={() => setPhase('results')}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Try Again"
                onPress={() => void startQuiz()}
                style={{ flex: 1 }}
              />
            </View>
          </>
        )}
      </ScrollView>
    );
  }

  if (phase === 'quiz' && questions.length) {
    const q = questions[index];
    const answeredCount = questions.filter((item) => isAnswered(item)).length;
    const current = answers[q.id] ?? {};

    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>
          {activeType.icon} {activeType.label} · {questions.length} questions ·{' '}
          {subjectSummary}
        </Text>
        <Text style={styles.progress}>
          Question {index + 1} of {questions.length}
          {answeredCount < questions.length
            ? ` · ${answeredCount}/${questions.length} answered`
            : ' · all answered'}
        </Text>

        <Card>
          <Text style={styles.kindBadge}>{kindLabel(q.kind)}</Text>
          <Text style={styles.question}>{q.question}</Text>

          {q.kind === 'typed_answer' || q.kind === 'fill_blank' ? (
            <TextInput
              value={String(current.text ?? '')}
              onChangeText={(text) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...prev[q.id], text },
                }))
              }
              placeholder={
                q.kind === 'fill_blank'
                  ? 'Type the missing word or phrase'
                  : 'Type your answer'
              }
              placeholderTextColor={colors.muted}
              style={styles.textAnswer}
              multiline
              autoCapitalize="sentences"
            />
          ) : (
            <View style={{ gap: 10, marginTop: 18 }}>
              {q.options.map((option, optIndex) => {
                const selected = current.selected_index === optIndex;
                return (
                  <Pressable
                    key={`${q.id}-${optIndex}`}
                    onPress={() =>
                      setAnswers((prev) => ({
                        ...prev,
                        [q.id]: {
                          ...prev[q.id],
                          selected_index: optIndex,
                        },
                      }))
                    }
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
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
                if (!isAnswered(q)) {
                  showToast('Answer this question first');
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
      <Text style={styles.h1}>Choose Quiz</Text>
      <Text style={[styles.sub, { marginBottom: 16 }]}>
        Pick a quiz style, subject, and length — then practice.
      </Text>

      <Text style={styles.sectionLabel}>Quiz type</Text>
      <View style={styles.typeList}>
        {QUIZ_TYPES.map((type) => {
          const active = quizType === type.id;
          return (
            <Pressable
              key={type.id}
              onPress={() => setQuizType(type.id)}
              style={[styles.typeRow, active && styles.typeRowActive]}
            >
              <Text style={[styles.typeTitle, active && styles.typeTitleActive]}>
                {type.icon} {type.label}
              </Text>
              <Text style={styles.sub}>{type.blurb}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Subjects</Text>
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

      <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
        Number of questions
      </Text>
      <View style={styles.countRow}>
        {QUIZ_COUNTS.map((n) => {
          const active = questionCount === n;
          return (
            <Pressable
              key={n}
              onPress={() => setQuestionCount(n)}
              style={[styles.countChip, active && styles.countChipActive]}
            >
              <Text
                style={[
                  styles.countChipText,
                  active && styles.countChipTextActive,
                ]}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Card style={{ marginTop: 16 }}>
        <Text style={styles.summaryLine}>
          {questionCount} questions · {subjectSummary || 'Pick a subject'}
        </Text>
        <Text style={[styles.sub, { marginTop: 6 }]}>
          {availableCards > 0
            ? `${activeType.icon} ${activeType.label} from ${availableCards} flashcards`
            : 'Generate flashcards first to unlock quiz questions'}
        </Text>
      </Card>

      <PrimaryButton
        label={loading ? 'Building quiz…' : 'Start quiz'}
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
  completeTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 8,
  },
  scoreLine: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 4,
  },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  sectionLabel: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 10,
  },
  eyebrow: { color: colors.muted, fontWeight: '700', marginBottom: 6 },
  progress: { color: colors.primary, fontWeight: '800', marginBottom: 14 },
  kindBadge: {
    alignSelf: 'flex-start',
    color: colors.primary,
    fontWeight: '800',
    fontSize: 12,
    marginBottom: 10,
  },
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
  textAnswer: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 96,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
    color: colors.ink,
    fontSize: 16,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  score: { fontSize: 56, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  statBox: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  statGood: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
  statBad: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },
  statLabel: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  statValue: { color: colors.ink, fontWeight: '800', fontSize: 28, marginTop: 4 },
  topicsHeading: { color: colors.ink, fontWeight: '800', fontSize: 16 },
  topicLine: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  typeList: { gap: 8 },
  typeRow: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
  },
  typeRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  typeTitle: { color: colors.ink, fontWeight: '800', fontSize: 16, marginBottom: 2 },
  typeTitleActive: { color: colors.primary },
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
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 52,
    alignItems: 'center',
  },
  countChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  countChipText: { color: colors.muted, fontWeight: '700' },
  countChipTextActive: { color: colors.primary },
  summaryLine: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  reviewCard: {
    marginBottom: 12,
    borderWidth: 1.5,
  },
  reviewCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.successSoft,
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
  yourAnswerLine: {
    marginTop: 10,
    fontWeight: '700',
    fontSize: 14,
  },
  yourAnswerCorrect: {
    color: '#1F7A4D',
  },
  yourAnswerWrong: {
    color: colors.danger,
  },
  correctAnswerLine: {
    marginTop: 8,
    fontWeight: '800',
    color: '#1F7A4D',
    fontSize: 14,
  },
});
