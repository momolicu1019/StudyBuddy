import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
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

const SWIPE_THRESHOLD = 56;

export function StudyScreen({ route, navigation }: Props) {
  const { subjectId } = route.params;
  const { subjects, showToast } = useApp();
  const subject = subjects.find((s) => s.id === subjectId);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const indexRef = useRef(0);
  const cardsLengthRef = useRef(0);
  indexRef.current = index;
  cardsLengthRef.current = cards.length;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.getFlashcards(subjectId);
        if (alive) {
          setCards(data);
          setIndex(0);
          setFlipped(false);
          setError(null);
        }
      } catch {
        if (alive) {
          setCards([]);
          setError('Could not load flashcards from local storage.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [subjectId]);

  function goPrevious() {
    if (indexRef.current <= 0) {
      showToast('This is the first card');
      return;
    }
    setFlipped(false);
    setIndex((i) => Math.max(0, i - 1));
  }

  function goNext() {
    if (indexRef.current >= cardsLengthRef.current - 1) {
      showToast('This is the last card');
      return;
    }
    setFlipped(false);
    setIndex((i) => Math.min(cardsLengthRef.current - 1, i + 1));
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx <= -SWIPE_THRESHOLD) {
            goNext();
            return;
          }
          if (gesture.dx >= SWIPE_THRESHOLD) {
            goPrevious();
            return;
          }
          if (Math.abs(gesture.dx) < 10 && Math.abs(gesture.dy) < 10) {
            setFlipped((f) => !f);
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable via refs
    [showToast],
  );

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
        <Text style={[styles.sub, { marginVertical: 10, textAlign: 'center' }]}>
          {error}
        </Text>
        <PrimaryButton label="Go back" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  if (!cards.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.h2}>No flashcards yet</Text>
        <Text style={[styles.sub, { marginVertical: 10, textAlign: 'center' }]}>
          Upload a PDF or photo on the Dashboard to generate cards for{' '}
          {subject?.name ?? 'this subject'}.
        </Text>
        <PrimaryButton label="Back to Dashboard" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const card = cards[index];
  const atStart = index <= 0;
  const atEnd = index >= cards.length - 1;

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>
        {subject?.icon} {subject?.name ?? 'Study'} · {index + 1}/{cards.length}
      </Text>

      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
        <Card style={[styles.card, flipped ? styles.cardFlipped : undefined]}>
          <Text style={styles.label}>{flipped ? 'Summary' : 'Key point'}</Text>
          <Text style={styles.prompt}>{flipped ? card.answer : card.question}</Text>
          <Text style={styles.hint}>Tap to flip · Swipe left/right to change cards</Text>
        </Card>
      </View>

      <View style={styles.row}>
        <PrimaryButton
          label="Previous"
          variant="secondary"
          onPress={goPrevious}
          style={{ flex: 1, opacity: atStart ? 0.5 : 1 }}
        />
        <PrimaryButton
          label="Next"
          onPress={goNext}
          style={{ flex: 1, opacity: atEnd ? 0.5 : 1 }}
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
    fontSize: 22,
    fontWeight: '750' as unknown as '700',
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 32,
    paddingHorizontal: 8,
  },
  hint: { marginTop: 28, color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 8 },
  h2: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted },
});
