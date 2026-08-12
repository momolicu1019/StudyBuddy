/**
 * Local OS notifications for nearing deadlines (amber + red only).
 *
 * Green / far deadlines are never scheduled. Reminders fire at 9:00 local
 * on each amber or red calendar day, with a one-time catch-up if the
 * morning slot already passed while the deadline is still nearing.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

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

const CHANNEL_ID = 'deadline-reminders';
const REMINDER_HOUR = 9;
const REMINDER_MINUTE = 0;
/** Keep nudging overdue (red) items for a few mornings. */
const OVERDUE_REMINDER_DAYS = 3;
const CATCHUP_PREFIX = 'deadline.notif.catchup.';
const DATA_TYPE = 'deadline';

let handlerReady = false;
let syncing: Promise<void> | null = null;

function canUseNotifications(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export function ensureDeadlineNotificationHandler(): void {
  if (!canUseNotifications() || handlerReady) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  handlerReady = true;
}

function reminderAt(day: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    REMINDER_HOUR,
    REMINDER_MINUTE,
    0,
    0,
  );
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

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Deadline reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#D84A62',
      sound: 'default',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
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

  // Avoid stacking catch-ups if the morning reminder is still upcoming today.
  const morning = reminderAt(startOfLocalDay(now));
  if (morning.getTime() > now.getTime()) return;

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

  for (
    let day = new Date(amberStart.getTime());
    day.getTime() <= rangeEnd.getTime();
    day = addDays(day, 1)
  ) {
    const urgency = getDeadlineUrgency(deadline.due_date, day);
    if (urgency === 'far') continue;

    const fireAt = reminderAt(day);
    if (fireAt.getTime() <= now.getTime()) continue;
    // Don't schedule far-future overdue nudges beyond what we need.
    if (day.getTime() < today.getTime() && urgency !== 'urgent') continue;

    await scheduleDateNotification({
      identifier: `deadline-${deadline.id}-${toIsoDate(day)}`,
      deadline,
      urgency,
      fireAt,
      asOf: day,
    });
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

  if (syncing) {
    await syncing;
  }

  syncing = (async () => {
    try {
      const granted = await ensurePermissionsAndChannel();
      if (!granted) return;

      await cancelDeadlineNotifications();

      const now = new Date();
      for (const deadline of deadlines) {
        if (deadline.completed) continue;
        await scheduleForDeadline(deadline, now);
      }
    } catch {
      // Notifications are best-effort; never block deadline CRUD.
    } finally {
      syncing = null;
    }
  })();

  await syncing;
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
  return Boolean(
    data &&
      typeof data === 'object' &&
      (data as { type?: string }).type === DATA_TYPE,
  );
}
