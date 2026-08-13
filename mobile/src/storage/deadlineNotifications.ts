/**
 * Local OS notifications for nearing deadlines (amber + red only).
 *
 * Green / far deadlines are never scheduled. Reminders fire every 2 hours
 * (local clock: :00 on even hours) on each amber or red calendar day, with a
 * one-time catch-up if every slot for today already passed while the deadline
 * is still nearing. Only the next few days of slots are queued so we stay under
 * the OS pending-notification limit; opening the app reschedules further out.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { ensureForegroundNotificationHandler } from './foregroundNotifications';
import {
  DEADLINE_CHANNEL_ID,
  ensureNotificationChannels,
} from './notificationChannels';
import type { Deadline } from './schema';
import {
  daysUntilDue,
  formatDueDate,
  getDeadlineUrgency,
  parseDueDate,
  startOfLocalDay,
  toIsoDate,
  type NearingUrgency,
} from './deadlineUtils';

const CHANNEL_ID = DEADLINE_CHANNEL_ID;
/** Remind every 2 hours on the local clock (00:00 … 22:00). */
const REMINDER_INTERVAL_HOURS = 2;
const REMINDER_HOURS = Array.from(
  { length: 24 / REMINDER_INTERVAL_HOURS },
  (_, i) => i * REMINDER_INTERVAL_HOURS,
);
const REMINDER_MINUTE = 0;
/**
 * Cap how far ahead we schedule DATE triggers. iOS allows ~64 pending
 * notifications app-wide; 72h × every 2h ≈ 36 slots per deadline.
 */
const SCHEDULE_LOOKAHEAD_MS = 72 * 60 * 60 * 1000;
/** Keep nudging overdue (red) items for a few days past due. */
const OVERDUE_REMINDER_DAYS = 3;
const CATCHUP_PREFIX = 'deadline.notif.catchup.';
const DATA_TYPE = 'deadline';

/** Serialize syncs so cancel+reschedule never races across account switches. */
let syncChain: Promise<void> = Promise.resolve();

function canUseNotifications(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export function ensureDeadlineNotificationHandler(): void {
  ensureForegroundNotificationHandler();
}

function reminderAt(day: Date, hour: number): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hour,
    REMINDER_MINUTE,
    0,
    0,
  );
}

function hourSlotLabel(hour: number): string {
  return String(hour).padStart(2, '0');
}

function addDays(day: Date, count: number): Date {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  next.setDate(next.getDate() + count);
  return next;
}

function notificationCopy(
  deadline: Deadline,
  urgency: NearingUrgency,
  now = new Date(),
): { title: string; body: string } {
  const days = daysUntilDue(deadline.due_date, now);
  const when = formatDueDate(deadline.due_date);

  if (urgency === 'urgent') {
    if (days < 0) {
      return {
        title: 'Overdue deadline',
        body: `“${deadline.title}” was due ${when}. Catch up when you can.`,
      };
    }
    if (days === 0) {
      return {
        title: 'Due today',
        body: `“${deadline.title}” is due today (${when}).`,
      };
    }
    return {
      title: 'Due tomorrow',
      body: `“${deadline.title}” is due tomorrow (${when}).`,
    };
  }

  return {
    title: 'Upcoming deadline',
    body: `“${deadline.title}” is due in ${days} days (${when}).`,
  };
}

async function ensurePermissionsAndChannel(): Promise<boolean> {
  if (!canUseNotifications()) return false;
  ensureDeadlineNotificationHandler();
  await ensureNotificationChannels();

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    status = requested.status;
  }
  return status === 'granted';
}

async function cancelDeadlineNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.content.data?.type === DATA_TYPE)
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

async function scheduleDateNotification(args: {
  identifier: string;
  deadline: Deadline;
  urgency: NearingUrgency;
  fireAt: Date;
  asOf: Date;
}): Promise<void> {
  const { title, body } = notificationCopy(args.deadline, args.urgency, args.asOf);
  await Notifications.scheduleNotificationAsync({
    identifier: args.identifier,
    content: {
      title,
      body,
      sound: true,
      data: {
        type: DATA_TYPE,
        deadlineId: args.deadline.id,
        screen: 'Deadlines',
        urgency: args.urgency,
      },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: args.fireAt,
    },
  });
}

async function maybeScheduleCatchup(
  deadline: Deadline,
  urgency: NearingUrgency,
  now: Date,
): Promise<void> {
  const todayIso = toIsoDate(now);
  const key = `${CATCHUP_PREFIX}${deadline.id}.${todayIso}`;
  const already = await AsyncStorage.getItem(key);
  if (already) return;

  // Skip catch-up when any of today's reminder slots is still upcoming.
  const today = startOfLocalDay(now);
  const nextSlotToday = REMINDER_HOURS.map((hour) => reminderAt(today, hour)).find(
    (slot) => slot.getTime() > now.getTime(),
  );
  if (nextSlotToday) return;

  await AsyncStorage.setItem(key, '1');
  const { title, body } = notificationCopy(deadline, urgency, now);
  await Notifications.scheduleNotificationAsync({
    identifier: `deadline-${deadline.id}-catchup-${todayIso}`,
    content: {
      title,
      body,
      sound: true,
      data: {
        type: DATA_TYPE,
        deadlineId: deadline.id,
        screen: 'Deadlines',
        urgency,
      },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 8,
    },
  });
}

async function scheduleForDeadline(deadline: Deadline, now: Date): Promise<void> {
  const dueDay = startOfLocalDay(parseDueDate(deadline.due_date));
  const amberStart = addDays(dueDay, -7);
  const rangeEnd = addDays(dueDay, OVERDUE_REMINDER_DAYS);
  const today = startOfLocalDay(now);
  const scheduleUntil = now.getTime() + SCHEDULE_LOOKAHEAD_MS;

  for (
    let day = new Date(amberStart.getTime());
    day.getTime() <= rangeEnd.getTime();
    day = addDays(day, 1)
  ) {
    const urgency = getDeadlineUrgency(deadline.due_date, day);
    if (urgency === 'far') continue;
    // Don't schedule past-day overdue nudges beyond what we need.
    if (day.getTime() < today.getTime() && urgency !== 'urgent') continue;

    const dayIso = toIsoDate(day);
    for (const hour of REMINDER_HOURS) {
      const fireAt = reminderAt(day, hour);
      if (fireAt.getTime() <= now.getTime()) continue;
      if (fireAt.getTime() > scheduleUntil) continue;

      await scheduleDateNotification({
        identifier: `deadline-${deadline.id}-${dayIso}-${hourSlotLabel(hour)}`,
        deadline,
        urgency,
        fireAt,
        asOf: day,
      });
    }
  }

  const current = getDeadlineUrgency(deadline.due_date, now);
  if (current === 'week' || current === 'urgent') {
    await maybeScheduleCatchup(deadline, current, now);
  }
}

/**
 * Request permission (if needed) and reschedule amber/red deadline reminders
 * from the current on-device deadline list.
 */
export async function syncDeadlineNotifications(
  deadlines: Deadline[],
): Promise<void> {
  if (!canUseNotifications()) return;

  const snapshot = deadlines.slice();
  const run = async () => {
    try {
      const granted = await ensurePermissionsAndChannel();
      if (!granted) return;

      await cancelDeadlineNotifications();

      const now = new Date();
      for (const deadline of snapshot) {
        if (deadline.completed) continue;
        await scheduleForDeadline(deadline, now);
      }
    } catch {
      // Notifications are best-effort; never block deadline CRUD.
    }
  };

  syncChain = syncChain.then(run, run);
  await syncChain;
}

/** Convenience: load is owned by caller; this just syncs a known list. */
export async function cancelAllDeadlineNotifications(): Promise<void> {
  if (!canUseNotifications()) return;
  try {
    await cancelDeadlineNotifications();
  } catch {
    // ignore
  }
}

export function isDeadlineNotificationResponse(
  data: unknown,
): data is { type: typeof DATA_TYPE; screen?: string } {
  let payload: unknown = data;
  if (typeof data === 'string') {
    try {
      payload = JSON.parse(data);
    } catch {
      return false;
    }
  }
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as { type?: unknown; dataString?: string };
  if (record.type === DATA_TYPE) return true;
  if (typeof record.dataString === 'string') {
    try {
      const nested = JSON.parse(record.dataString) as { type?: unknown };
      return nested.type === DATA_TYPE;
    } catch {
      return false;
    }
  }
  return false;
}
