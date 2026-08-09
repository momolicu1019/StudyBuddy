import React, { useEffect, useState } from 'react';
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
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Quiz'>;

export function QuizScreen({ route, navigation }: Props) {
  const { subjects, showToast, refresh } = useApp();
  const subjectId = route.params?.subjectId ?? subjects[0]?.id;
  const subject = subjects.find((s) => s.id === subjectId);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subjectId) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const data = await api.getQuiz(subjectId);
        if (alive) {
          setQuestions(data);
          setError(null);
        }
      } catch {
        if (alive) {
          setQuestions([]);
          setError('Could not load quiz from local storage.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subjectId]);

  async function submit() {
    if (!subjectId) return;
    try {
      const res = await api.submitQuiz(subjectId, answers);
      setResult(res);
      await refresh();
    } catch {
      showToast('Could not submit quiz. Try again.');
    }
  }

  if (!subjectId) {
    return (
      <View style={styles.center}>
        <Text style={styles.h2}>Create a subject first</Text>
        <Text style={[styles.sub, { textAlign: 'center', marginVertical: 10 }]}>
          Make a subject folder, upload notes, then come back to quiz.
        </Text>
        <PrimaryButton
          label="Go to Flashcards"
          onPress={() => navigation.navigate('Flashcards')}
          style={{ marginTop: 12 }}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.h2}>Unable to load</Text>
        <Text style={[styles.sub, { textAlign: 'center', marginVertical: 10 }]}>
          {error}
        </Text>
        <PrimaryButton label="Go back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  if (!questions.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.h2}>No quiz yet</Text>
        <Text style={[styles.sub, { textAlign: 'center', marginVertical: 10 }]}>
          {subject?.name ?? 'This subject'} has no flashcards. Upload a PDF or photo
          on the Dashboard first.
        </Text>
        <PrimaryButton
          label="Go back"
          onPress={() => navigation.goBack()}
          style={{ marginTop: 8 }}
        />
      </View>
    );
  }

  if (result) {
    return (
      <View style={styles.center}>
        <Text style={styles.score}>{result.percentage}%</Text>
        <Text style={styles.h2}>
          {result.score}/{result.total} correct
        </Text>
        <Text style={[styles.sub, { textAlign: 'center', marginVertical: 12 }]}>
          {result.message}
        </Text>
        <PrimaryButton
          label="Study Flashcards"
          onPress={() => navigation.navigate('Study', { subjectId })}
          style={{ width: '100%', marginBottom: 10 }}
        />
        <PrimaryButton
          label="Back"
          variant="secondary"
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else setResult(null);
          }}
          style={{ width: '100%' }}
        />
      </View>
    );
  }

  const q = questions[index];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>
        🧠 Quiz Mode · {subject?.icon} {subject?.name}
      </Text>
      <Text style={styles.progress}>
        Question {index + 1} of {questions.length}
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
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
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
            label="Submit quiz"
            onPress={() => {
              if (Object.keys(answers).length < questions.length) {
                showToast('Answer every question first');
                return;
              }
              void submit();
            }}
            style={{ flex: 1 }}
          />
        )}
      </View>
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
  h2: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
