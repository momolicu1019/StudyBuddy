import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  ScrollView,
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
  const { subjects, showToast, applySubjectUpdate, setStats } = useApp();
  const subject = subjects.find((s) => s.id === subjectId);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const indexRef = useRef(0);
  const cardsRef = useRef<Flashcard[]>([]);
  const markingRef = useRef<Set<number>>(new Set());
  indexRef.current = index;
  cardsRef.current = cards;

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

  const markCardMastered = useCallback(
    async (cardId: number) => {
      const current = cardsRef.current.find((c) => c.id === cardId);
      if (!current || current.mastered || markingRef.current.has(cardId)) return;

      markingRef.current.add(cardId);
      try {
        const res = await api.reviewFlashcard(subjectId, cardId, true);
        setCards((prev) =>
          prev.map((c) => (c.id === cardId ? { ...c, mastered: true } : c)),
        );
        applySubjectUpdate(res.subject);
        setStats(res.stats);

        if (res.subject.cards > 0 && res.subject.mastered >= res.subject.cards) {
          showToast('All cards mastered for this folder');
        }
      } catch {
        // Keep studying even if progress write fails.
      } finally {
        markingRef.current.delete(cardId);
      }
    },
    [applySubjectUpdate, setStats, showToast, subjectId],
  );

  function revealExplanation() {
    setFlipped((wasFlipped) => {
      const next = !wasFlipped;
      if (!wasFlipped && next) {
        const cardId = cardsRef.current[indexRef.current]?.id;
        if (cardId != null) void markCardMastered(cardId);
      }
      return next;
    });
  }

  function goPrevious() {
    if (indexRef.current <= 0) {
      showToast('This is the first card');
      return;
    }
    setFlipped(false);
    setIndex((i) => Math.max(0, i - 1));
  }

  function goNext() {
    const current = cardsRef.current[indexRef.current];
    // Advancing after reading counts as mastered even if they didn't flip first.
    if (current && !current.mastered) {
      void markCardMastered(current.id);
    }

    if (indexRef.current >= cardsRef.current.length - 1) {
      showToast('Deck finished — progress saved');
      return;
    }
    setFlipped(false);
    setIndex((i) => Math.min(cardsRef.current.length - 1, i + 1));
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
            revealExplanation();
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable via refs
    [markCardMastered, showToast],
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
          Upload a file or photo on the Dashboard to generate cards for{' '}
          {subject?.name ?? 'this subject'}.
        </Text>
        <PrimaryButton label="Back to Dashboard" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const card = cards[index];
  const atStart = index <= 0;
  const atEnd = index >= cards.length - 1;
  const masteredCount = cards.filter((c) => c.mastered).length;
  const progressPct = cards.length
    ? Math.round((masteredCount / cards.length) * 100)
    : 0;

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>
        {subject?.icon} {subject?.name ?? 'Study'} · {index + 1}/{cards.length}
        {` · ${progressPct}% mastered`}
      </Text>

      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
        <Card style={[styles.card, flipped ? styles.cardFlipped : undefined]}>
          <Text style={styles.label}>{flipped ? 'Explanation' : 'Key concept'}</Text>
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={flipped}
          >
            <Text style={[styles.prompt, flipped && styles.promptExplanation]}>
              {flipped ? card.answer : card.question}
            </Text>
          </ScrollView>
          <Text style={styles.hint}>
            {card.mastered
              ? 'Mastered · Tap to flip · Swipe to change cards'
              : 'Tap to reveal explanation (marks mastered) · Swipe/Next also saves progress'}
          </Text>
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
          label={atEnd ? 'Finish' : 'Next'}
          onPress={goNext}
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
    alignItems: 'stretch',
    backgroundColor: '#fff',
  },
  cardFlipped: { backgroundColor: colors.purpleTint },
  label: {
    color: colors.primary,
    fontWeight: '800',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
    textAlign: 'center',
  },
  bodyScroll: { flexGrow: 1, flexShrink: 1 },
  bodyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  prompt: {
    fontSize: 22,
    fontWeight: '750' as unknown as '700',
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 32,
    paddingHorizontal: 8,
  },
  promptExplanation: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'left',
  },
  hint: { marginTop: 16, color: colors.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 8 },
  h2: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted },
});
