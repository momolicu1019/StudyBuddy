import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { api } from '../api/client';
import type { Flashcard } from '../api/types';
import { Card, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Study'>;

export function StudyScreen({ route, navigation }: Props) {
  const { subjectId } = route.params;
  const { subjects, showToast } = useApp();
  const subject = subjects.find((s) => s.id === subjectId);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.getFlashcards(subjectId);
        if (alive) setCards(data);
      } catch {
        if (alive) {
          setCards([
            {
              id: 1,
              question: `What is a key idea in ${subject?.name ?? 'this subject'}?`,
              answer: 'Review your notes and explain the concept in your own words.',
              mastered: false,
            },
            {
              id: 2,
              question: 'How can you remember this better?',
              answer: 'Use active recall and spaced repetition with short daily sessions.',
              mastered: false,
            },
          ]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subjectId, subject?.name]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!cards.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.h2}>No flashcards yet</Text>
        <Text style={[styles.sub, { marginVertical: 10, textAlign: 'center' }]}>
          Generate cards from a PDF or photo on the Dashboard.
        </Text>
        <PrimaryButton label="Back to Dashboard" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const card = cards[index];

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>
        {subject?.icon} {subject?.name ?? 'Study'} · {index + 1}/{cards.length}
      </Text>
      <Pressable onPress={() => setFlipped((f) => !f)} style={{ flex: 1 }}>
        <Card style={[styles.card, flipped ? styles.cardFlipped : undefined]}>
          <Text style={styles.label}>{flipped ? 'Answer' : 'Question'}</Text>
          <Text style={styles.prompt}>{flipped ? card.answer : card.question}</Text>
          <Text style={styles.hint}>Tap card to flip</Text>
        </Card>
      </Pressable>
      <View style={styles.row}>
        <PrimaryButton
          label="Previous"
          variant="secondary"
          onPress={() => {
            setFlipped(false);
            setIndex((i) => Math.max(0, i - 1));
          }}
          style={{ flex: 1 }}
        />
        <PrimaryButton
          label={index === cards.length - 1 ? 'Done' : 'Next'}
          onPress={() => {
            if (index === cards.length - 1) {
              showToast('Study session complete! 🎉');
              navigation.goBack();
              return;
            }
            setFlipped(false);
            setIndex((i) => i + 1);
          }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  eyebrow: { color: colors.muted, fontWeight: '700', marginBottom: 14 },
  card: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  cardFlipped: { backgroundColor: colors.purpleTint },
  label: {
    color: colors.primary,
    fontWeight: '800',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
  },
  prompt: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 34,
  },
  hint: { marginTop: 28, color: colors.muted },
  row: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 8 },
  h2: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted },
});
