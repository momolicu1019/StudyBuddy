import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { explanationToBullets, isExampleBullet, normalizeKeyPointTitle } from '../storage/explanationFormat';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Study'>;

const SWIPE_THRESHOLD = 56;
const FLIP_SPRING = { friction: 8, tension: 58, useNativeDriver: true as const };
const PAGE_MS = 440;

type PageTurn = {
  card: Flashcard;
  direction: 'next' | 'prev';
};

function FrontFaceContent({
  keyConcept,
  onReveal,
}: {
  keyConcept: string;
  onReveal?: () => void;
}) {
  return (
    <Pressable
      style={styles.frontPress}
      onPress={onReveal}
      disabled={!onReveal}
      accessibilityRole="button"
      accessibilityLabel="Reveal explanation"
    >
      <Text style={styles.prompt}>{keyConcept}</Text>
      <Text style={styles.tapCue}>Tap to reveal explanation</Text>
    </Pressable>
  );
}

function BackFaceContent({
  answer,
  onReveal,
}: {
  answer: string;
  onReveal?: () => void;
}) {
  const explanationBullets = explanationToBullets(answer || '');
  return (
    <ScrollView
      style={styles.bodyScroll}
      contentContainerStyle={styles.bodyContent}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={onReveal} disabled={!onReveal}>
        {explanationBullets.length ? (
          <View style={styles.bulletList}>
            {explanationBullets.map((line, i) => {
              const example = isExampleBullet(line);
              return (
                <View
                  key={`${i}-${line.slice(0, 24)}`}
                  style={[styles.bulletRow, example ? styles.exampleRow : null]}
                >
                  <Text style={[styles.bulletMark, example ? styles.exampleMark : null]}>
                    {example ? '✦' : '•'}
                  </Text>
                  <Text
                    style={[
                      styles.prompt,
                      styles.promptExplanation,
                      example ? styles.exampleText : null,
                    ]}
                  >
                    {line}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.prompt, styles.promptExplanation]}>
            No explanation saved for this card.
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function FlipCard({
  card,
  flipAnim,
  flipped,
  onToggle,
}: {
  card: Flashcard;
  flipAnim: Animated.Value;
  flipped: boolean;
  onToggle: () => void;
}) {
  const keyConcept = normalizeKeyPointTitle(card.question || '', card.answer);

  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });
  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  return (
    <View style={styles.flipScene}>
      <Animated.View
        pointerEvents={flipped ? 'none' : 'auto'}
        style={[
          styles.face,
          styles.faceFront,
          styles.faceLayer,
          {
            opacity: frontOpacity,
            transform: [{ perspective: 1400 }, { rotateY: frontRotate }],
          },
        ]}
      >
        <Text style={styles.label}>Key concept</Text>
        <FrontFaceContent keyConcept={keyConcept} onReveal={onToggle} />
        <PrimaryButton
          label="Show explanation"
          variant="secondary"
          onPress={onToggle}
          style={{ marginTop: 12 }}
        />
      </Animated.View>

      <Animated.View
        pointerEvents={flipped ? 'auto' : 'none'}
        style={[
          styles.face,
          styles.faceBack,
          styles.faceLayer,
          {
            opacity: backOpacity,
            transform: [{ perspective: 1400 }, { rotateY: backRotate }],
          },
        ]}
      >
        <Text style={styles.label}>Explanation</Text>
        <BackFaceContent answer={card.answer || ''} onReveal={onToggle} />
        <PrimaryButton
          label="Show key concept"
          variant="secondary"
          onPress={onToggle}
          style={{ marginTop: 12 }}
        />
      </Animated.View>
    </View>
  );
}

function StaticPageCard({ card }: { card: Flashcard }) {
  const keyConcept = normalizeKeyPointTitle(card.question || '', card.answer);
  return (
    <View style={[styles.face, styles.faceFront, styles.staticPage]}>
      <Text style={styles.label}>Key concept</Text>
      <FrontFaceContent keyConcept={keyConcept} />
      <View style={styles.ghostBtn}>
        <Text style={styles.ghostBtnText}>Show explanation</Text>
      </View>
    </View>
  );
}

export function StudyScreen({ route, navigation }: Props) {
  const { subjectId } = route.params;
  const { subjects, showToast, applySubjectUpdate, setStats } = useApp();
  const subject = subjects.find((s) => s.id === subjectId);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageTurn, setPageTurn] = useState<PageTurn | null>(null);
  const [cardWidth, setCardWidth] = useState(0);

  const indexRef = useRef(0);
  const cardsRef = useRef<Flashcard[]>([]);
  const markingRef = useRef<Set<number>>(new Set());
  const navLockRef = useRef(false);
  const flipAnim = useRef(new Animated.Value(0)).current;
  const pageAnim = useRef(new Animated.Value(0)).current;

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
          flipAnim.setValue(0);
          setPageTurn(null);
          pageAnim.setValue(0);
          navLockRef.current = false;
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
  }, [subjectId, flipAnim, pageAnim]);

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
    if (navLockRef.current) return;
    setFlipped((wasFlipped) => {
      const next = !wasFlipped;
      Animated.spring(flipAnim, { ...FLIP_SPRING, toValue: next ? 1 : 0 }).start();
      if (!wasFlipped && next) {
        const cardId = cardsRef.current[indexRef.current]?.id;
        if (cardId != null) void markCardMastered(cardId);
      }
      return next;
    });
  }, [flipAnim, markCardMastered]);

  const runPageTurn = useCallback(
    (nextIndex: number, direction: 'next' | 'prev') => {
      if (navLockRef.current) return;
      const leaving = cardsRef.current[indexRef.current];
      if (!leaving) return;

      navLockRef.current = true;
      setFlipped(false);
      flipAnim.setValue(0);
      setPageTurn({ card: leaving, direction });
      pageAnim.setValue(0);
      setIndex(nextIndex);

      Animated.timing(pageAnim, {
        toValue: 1,
        duration: PAGE_MS,
        easing: Easing.bezier(0.22, 0.61, 0.36, 1),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setPageTurn(null);
        pageAnim.setValue(0);
        navLockRef.current = false;
      });
    },
    [flipAnim, pageAnim],
  );

  const goPrevious = useCallback(() => {
    if (navLockRef.current) return;
    if (indexRef.current <= 0) {
      showToast('This is the first card');
      return;
    }
    runPageTurn(indexRef.current - 1, 'prev');
  }, [runPageTurn, showToast]);

  const goNext = useCallback(() => {
    if (navLockRef.current) return;
    const current = cardsRef.current[indexRef.current];
    if (current && !current.mastered) {
      void markCardMastered(current.id);
    }

    if (indexRef.current >= cardsRef.current.length - 1) {
      showToast('Deck finished — progress saved');
      return;
    }
    runPageTurn(indexRef.current + 1, 'next');
  }, [markCardMastered, runPageTurn, showToast]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !navLockRef.current &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
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

  const pivot = Math.max(cardWidth, 1) / 2;
  const isNextTurn = pageTurn?.direction !== 'prev';

  const turningRotate = pageAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isNextTurn ? ['0deg', '-105deg'] : ['0deg', '105deg'],
  });
  const turningOpacity = pageAnim.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [1, 0.55, 0],
  });
  const incomingScale = pageAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1],
  });
  const incomingOpacity = pageAnim.interpolate({
    inputRange: [0, 0.25, 1],
    outputRange: [0.65, 0.9, 1],
  });

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
  const progressPercent = cards.length
    ? Math.round((masteredCount / cards.length) * 100)
    : 0;

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>
        {subject?.icon} {subject?.name ?? 'Study'} · {index + 1}/{cards.length}
        {` · ${progressPercent}% mastered`}
      </Text>

      <View
        style={styles.stage}
        onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
      >
        <Animated.View
          style={[
            styles.cardShell,
            pageTurn
              ? {
                  opacity: incomingOpacity,
                  transform: [{ scale: incomingScale }],
                }
              : undefined,
          ]}
        >
          <FlipCard
            card={card}
            flipAnim={flipAnim}
            flipped={flipped}
            onToggle={revealExplanation}
          />
        </Animated.View>

        {pageTurn ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.cardShell,
              styles.pageOverlay,
              {
                opacity: turningOpacity,
                transform: [
                  { perspective: 1600 },
                  { translateX: isNextTurn ? -pivot : pivot },
                  { rotateY: turningRotate },
                  { translateX: isNextTurn ? pivot : -pivot },
                ],
              },
            ]}
          >
            <StaticPageCard card={pageTurn.card} />
          </Animated.View>
        ) : null}
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
  stage: {
    flex: 1,
    position: 'relative',
  },
  cardShell: {
    flex: 1,
    borderRadius: 20,
    shadowColor: '#251f4d',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  pageOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
  },
  flipScene: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  face: {
    borderRadius: 20,
    borderWidth: 0,
    padding: 20,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
  },
  faceFront: {
    backgroundColor: '#fff',
  },
  faceBack: {
    backgroundColor: colors.purpleTint,
  },
  faceLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  staticPage: {
    flex: 1,
  },
  ghostBtn: {
    marginTop: 12,
    backgroundColor: colors.primarySoft,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  ghostBtnText: {
    color: colors.primary,
    fontWeight: '750' as unknown as '700',
    fontSize: 15,
  },
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
  exampleRow: {
    backgroundColor: '#F3EEFF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginTop: 2,
  },
  exampleMark: {
    color: colors.primary,
  },
  exampleText: {
    color: colors.ink,
    fontWeight: '700',
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
