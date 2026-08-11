import type { Deadline } from './schema';
import { colors } from '../theme/colors';

export type DeadlineUrgency = 'far' | 'week' | 'urgent';
export type NearingUrgency = Exclude<DeadlineUrgency, 'far'>;

export type UrgencyTone = {
  border: string;
  background: string;
  badge: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Parse a YYYY-MM-DD due date as a local calendar day. */
export function parseDueDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDueDate(isoDate: string): string {
  return parseDueDate(isoDate).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Whole days from today until the due date (negative if past due). */
export function daysUntilDue(isoDate: string, now = new Date()): number {
  const due = startOfLocalDay(parseDueDate(isoDate)).getTime();
  const today = startOfLocalDay(now).getTime();
  return Math.round((due - today) / DAY_MS);
}

/**
 * Green when still far (> 1 week), amber within a week, red 1 day before or past due.
 */
export function getDeadlineUrgency(
  isoDate: string,
  now = new Date(),
): DeadlineUrgency {
  const days = daysUntilDue(isoDate, now);
  if (days > 7) return 'far';
  if (days > 1) return 'week';
  return 'urgent';
}

export function urgencyLabel(urgency: DeadlineUrgency, days: number): string {
  if (urgency === 'far') {
    return days === 1 ? '1 day left' : `${days} days left`;
  }
  if (urgency === 'week') {
    return days === 1 ? '1 day left' : `${days} days left`;
  }
  if (days < 0) {
    const overdue = Math.abs(days);
    return overdue === 1 ? '1 day overdue' : `${overdue} days overdue`;
  }
  if (days === 0) return 'Due today';
  return 'Due tomorrow';
}

/** Bulb when an incomplete deadline is 1 day away, due today, or already past. */
export function needsDeadlineBulb(
  deadlines: Deadline[],
  now = new Date(),
): boolean {
  return deadlines.some(
    (item) => !item.completed && daysUntilDue(item.due_date, now) <= 1,
  );
}

/**
 * Among incomplete deadlines that are amber (within a week) or red (≤1 day),
 * return the urgency of the nearest one. Null when nothing is nearing.
 */
export function getNearestNearingUrgency(
  deadlines: Deadline[],
  now = new Date(),
): NearingUrgency | null {
  let nearestDays: number | null = null;
  let nearestUrgency: NearingUrgency | null = null;

  for (const item of deadlines) {
    if (item.completed) continue;
    const days = daysUntilDue(item.due_date, now);
    if (days > 7) continue;
    const urgency: NearingUrgency = days > 1 ? 'week' : 'urgent';
    if (nearestDays === null || days < nearestDays) {
      nearestDays = days;
      nearestUrgency = urgency;
    }
  }

  return nearestUrgency;
}

/** Border / soft fill / badge colors for a deadline urgency level. */
export function urgencyTone(urgency: DeadlineUrgency): UrgencyTone {
  if (urgency === 'far') {
    return {
      border: colors.success,
      background: colors.successSoft,
      badge: colors.success,
    };
  }
  if (urgency === 'week') {
    return {
      border: colors.warning,
      background: colors.warningSoft,
      badge: '#C9841A',
    };
  }
  return {
    border: colors.danger,
    background: colors.dangerSoft,
    badge: colors.danger,
  };
}

export function sortDeadlines(deadlines: Deadline[]): Deadline[] {
  return [...deadlines].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const byDate = a.due_date.localeCompare(b.due_date);
    if (byDate !== 0) return byDate;
    return b.created_at.localeCompare(a.created_at);
  });
}
