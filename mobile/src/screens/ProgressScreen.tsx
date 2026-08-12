import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { api } from '../api/client';
import { Card, PrimaryButton } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import type { ProgressAnalytics } from '../storage/progressAnalytics';
import { formatStudyTimeFromHours } from '../storage/progressAnalytics';
import { colors } from '../theme/colors';

const BAR_MAX_HEIGHT = 120;

export function ProgressScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<ProgressAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const analytics = await api.getProgressAnalytics();
      setData(analytics);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const maxScore = useMemo(() => {
    if (!data?.week.length) return 1;
    return Math.max(1, ...data.week.map((d) => d.score));
  }, [data]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const analytics = data ?? {
    week: [],
    total_study_time_label: '0m',
    cards_reviewed: 0,
    quiz_accuracy: 0,
    strongest: null,
    needs_attention: null,
    week_study_minutes: 0,
  };

  const weekMinutesLabel = formatStudyTimeFromHours(
    analytics.week_study_minutes / 60,
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>📊 My Progress</Text>
      <Text style={[styles.sub, { marginBottom: 18 }]}>
        See how your study habits improve week by week.
      </Text>

      <Card>
        <Text style={styles.sectionTitle}>This Week</Text>
        <Text style={[styles.sub, { marginTop: 4, marginBottom: 16 }]}>
          {analytics.week_study_minutes > 0
            ? `${weekMinutesLabel} focused · Mon–Fri activity`
            : 'Complete focus sessions, reviews, or quizzes to fill the chart'}
        </Text>

        <View style={styles.chart}>
          {analytics.week.map((day) => {
            const height =
              day.score <= 0
                ? 6
                : Math.max(10, Math.round((day.score / maxScore) * BAR_MAX_HEIGHT));
            const active = day.score > 0;
            return (
              <View key={day.date} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        height,
                        backgroundColor: active
                          ? colors.primary
                          : '#E4E2F2',
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.barLabel, active && styles.barLabelActive]}>
                  {day.label}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>

      <View style={styles.metrics}>
        <Card style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total study time</Text>
          <Text style={styles.metricValue}>
            {analytics.total_study_time_label}
          </Text>
        </Card>
        <Card style={styles.metricCard}>
          <Text style={styles.metricLabel}>Cards reviewed</Text>
          <Text style={styles.metricValue}>{analytics.cards_reviewed}</Text>
        </Card>
        <Card style={styles.metricCard}>
          <Text style={styles.metricLabel}>Quiz accuracy</Text>
          <Text style={styles.metricValue}>{analytics.quiz_accuracy}%</Text>
        </Card>
      </View>

      <Card style={{ marginTop: 4 }}>
        <Text style={styles.sectionTitle}>Strongest subject</Text>
        {analytics.strongest ? (
          <Pressable
            onPress={() =>
              navigation.navigate('Study', { subjectId: analytics.strongest!.id })
            }
            style={styles.subjectRow}
          >
            <Text style={styles.subjectName}>
              {analytics.strongest.icon} {analytics.strongest.name}
            </Text>
            <Text style={styles.subjectMeta}>
              {analytics.strongest.mastered}/{analytics.strongest.cards} mastered
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.sub, { marginTop: 8 }]}>
            Study a subject to unlock this insight.
          </Text>
        )}

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Needs attention</Text>
        {analytics.needs_attention ? (
          <Pressable
            onPress={() =>
              navigation.navigate('Study', {
                subjectId: analytics.needs_attention!.id,
              })
            }
            style={styles.subjectRow}
          >
            <Text style={styles.subjectName}>
              {analytics.needs_attention.icon} {analytics.needs_attention.name}
            </Text>
            <Text style={styles.subjectMeta}>
              {analytics.needs_attention.mastered}/
              {analytics.needs_attention.cards} mastered · keep practicing
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.sub, { marginTop: 8 }]}>
            No weak spots yet — add flashcards to track this.
          </Text>
        )}
      </Card>

      <PrimaryButton
        label="Start a focus session"
        onPress={() => navigation.navigate('Pomodoro')}
        style={{ marginTop: 18 }}
      />
      <PrimaryButton
        label="Take a quiz"
        variant="secondary"
        onPress={() => navigation.navigate('Quiz', {})}
        style={{ marginTop: 10, marginBottom: 24 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  h1: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 6,
  },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: BAR_MAX_HEIGHT + 28,
  },
  barCol: { flex: 1, alignItems: 'center' },
  barTrack: {
    height: BAR_MAX_HEIGHT,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: '70%',
    maxWidth: 28,
    borderRadius: 8,
    minHeight: 6,
  },
  barLabel: {
    marginTop: 8,
    color: colors.muted,
    fontWeight: '700',
    fontSize: 12,
  },
  barLabelActive: { color: colors.primary },
  metrics: {
    marginTop: 14,
    gap: 10,
  },
  metricCard: { paddingVertical: 16 },
  metricLabel: {
    color: colors.muted,
    fontWeight: '700',
    fontSize: 13,
  },
  metricValue: {
    marginTop: 6,
    color: colors.primary,
    fontWeight: '800',
    fontSize: 28,
  },
  subjectRow: { marginTop: 10 },
  subjectName: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 18,
  },
  subjectMeta: {
    color: colors.muted,
    marginTop: 4,
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 16,
  },
});
