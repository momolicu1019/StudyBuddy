import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
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
import { explanationToBullets, normalizeKeyPointTitle } from '../storage/explanationFormat';
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
  const flippedRef = useRef(false);
  indexRef.current = index;
  cardsRef.current = cards;
  flippedRef.current = flipped;

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

  const revealExplanation = useCallback(() => {
    setFlipped((wasFlipped) => {
      const next = !wasFlipped;
      if (!wasFlipped && next) {
        const cardId = cardsRef.current[indexRef.current]?.id;
        if (cardId != null) void markCardMastered(cardId);
      }
      return next;
    });
  }, [markCardMastered]);

  const goPrevious = useCallback(() => {
    if (indexRef.current <= 0) {
      showToast('This is the first card');
      return;
    }
    setFlipped(false);
    setIndex((i) => Math.max(0, i - 1));
  }, [showToast]);

  const goNext = useCallback(() => {
    const current = cardsRef.current[indexRef.current];
    if (current && !current.mastered) {
      void markCardMastered(current.id);
    }

    if (indexRef.current >= cardsRef.current.length - 1) {
      showToast('Deck finished — progress saved');
      return;
    }
    setFlipped(false);
    setIndex((i) => Math.min(cardsRef.current.length - 1, i + 1));
  }, [markCardMastered, showToast]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx <= -SWIPE_THRESHOLD) {
            goNext();
            return;
          }
          if (gesture.dx >= SWIPE_THRESHOLD) {
            goPrevious();
          }
        },
      }),
    [goNext, goPrevious],
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
  const explanationBullets = explanationToBullets(card.answer || '');
  const keyConcept = normalizeKeyPointTitle(card.question || '', card.answer);
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

          {flipped ? (
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              <Pressable onPress={revealExplanation}>
                {explanationBullets.length ? (
                  <View style={styles.bulletList}>
                    {explanationBullets.map((line, i) => (
                      <View key={`${i}-${line.slice(0, 24)}`} style={styles.bulletRow}>
                        <Text style={styles.bulletMark}>•</Text>
                        <Text style={[styles.prompt, styles.promptExplanation]}>
                          {line}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.prompt, styles.promptExplanation]}>
                    No explanation saved for this card.
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          ) : (
            <Pressable
              style={styles.frontPress}
              onPress={revealExplanation}
              accessibilityRole="button"
              accessibilityLabel="Reveal explanation"
            >
              <Text style={styles.prompt}>{keyConcept}</Text>
              <Text style={styles.tapCue}>Tap to reveal explanation</Text>
            </Pressable>
          )}

          <PrimaryButton
            label={flipped ? 'Show key concept' : 'Show explanation'}
            variant="secondary"
            onPress={revealExplanation}
            style={{ marginTop: 12 }}
          />
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
  frontPress: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 12,
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
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'left',
  },
  bulletList: {
    gap: 10,
    width: '100%',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
  },
  bulletMark: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 24,
    width: 14,
  },
  tapCue: {
    marginTop: 18,
    color: colors.muted,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 8 },
  h2: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted },
});
