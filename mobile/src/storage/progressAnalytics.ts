import type { Subject } from '../api/types';
import type { ActivityDay, LocalDatabase } from './schema';

export type WeekDayBar = {
  label: string;
  date: string;
  /** Relative activity score used for bar height. */
  score: number;
  focus_minutes: number;
  cards_reviewed: number;
  quizzes_taken: number;
};

export type ProgressAnalytics = {
  week: WeekDayBar[];
  total_study_time_label: string;
  cards_reviewed: number;
  quiz_accuracy: number;
  strongest: Subject | null;
  needs_attention: Subject | null;
  week_study_minutes: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar YYYY-MM-DD. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function emptyActivityDay(): ActivityDay {
  return { focus_minutes: 0, cards_reviewed: 0, quizzes_taken: 0 };
}

export function bumpActivityDay(
  db: LocalDatabase,
  patch: Partial<ActivityDay>,
  date = new Date(),
): void {
  const key = localDateKey(date);
  const current = db.activity_days[key] ?? emptyActivityDay();
  db.activity_days[key] = {
    focus_minutes: current.focus_minutes + (patch.focus_minutes ?? 0),
    cards_reviewed: current.cards_reviewed + (patch.cards_reviewed ?? 0),
    quizzes_taken: current.quizzes_taken + (patch.quizzes_taken ?? 0),
  };
}

export function formatStudyTimeFromHours(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function activityScore(day: ActivityDay): number {
  return day.focus_minutes + day.cards_reviewed * 3 + day.quizzes_taken * 8;
}

function masteryRatio(subject: Subject): number {
  if (subject.cards <= 0) return 0;
  return subject.mastered / subject.cards;
}

function pickSubjectInsights(subjects: Subject[]): {
  strongest: Subject | null;
  needs_attention: Subject | null;
} {
  const eligible = subjects.filter((s) => s.cards > 0);
  if (!eligible.length) return { strongest: null, needs_attention: null };

  const byStrong = [...eligible].sort((a, b) => {
    const diff = masteryRatio(b) - masteryRatio(a);
    if (diff !== 0) return diff;
    return b.mastered - a.mastered;
  });
  const byWeak = [...eligible].sort((a, b) => {
    const diff = masteryRatio(a) - masteryRatio(b);
    if (diff !== 0) return diff;
    return a.mastered - b.mastered;
  });

  return {
    strongest: byStrong[0] ?? null,
    needs_attention: byWeak[0] ?? null,
  };
}

/**
 * Build Mon–Fri bars for the current local week (week starts Monday).
 */
export function buildWeekBars(
  activityDays: Record<string, ActivityDay>,
  now = new Date(),
): WeekDayBar[] {
  const day = now.getDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(now.getDate() + mondayOffset);

  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
  const bars: WeekDayBar[] = [];

  for (let i = 0; i < 5; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = localDateKey(d);
    const activity = activityDays[key] ?? emptyActivityDay();
    bars.push({
      label: labels[i],
      date: key,
      score: activityScore(activity),
      focus_minutes: activity.focus_minutes,
      cards_reviewed: activity.cards_reviewed,
      quizzes_taken: activity.quizzes_taken,
    });
  }

  return bars;
}

export function buildProgressAnalytics(db: LocalDatabase): ProgressAnalytics {
  const week = buildWeekBars(db.activity_days);
  const week_study_minutes = week.reduce((sum, d) => sum + d.focus_minutes, 0);
  const { strongest, needs_attention } = pickSubjectInsights(db.subjects);

  return {
    week,
    total_study_time_label: formatStudyTimeFromHours(db.progress.focus_hours),
    cards_reviewed: db.progress.flashcards_reviewed,
    quiz_accuracy: db.progress.quiz_average,
    strongest,
    needs_attention,
    week_study_minutes,
  };
}
