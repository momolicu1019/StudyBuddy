/**
 * Android notification channels for chat + deadline reminders.
 * Channels must exist before a remote push with that channelId arrives —
 * otherwise Android 8+ silently drops the notification.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export const CHAT_CHANNEL_ID = 'chat-messages';
export const DEADLINE_CHANNEL_ID = 'deadline-reminders';

let channelsReady: Promise<void> | null = null;

async function createChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(CHAT_CHANNEL_ID, {
    name: 'Messages',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6C63FF',
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
    enableVibrate: true,
    showBadge: true,
  });

  await Notifications.setNotificationChannelAsync(DEADLINE_CHANNEL_ID, {
    name: 'Deadline reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#D84A62',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
  });
}

/** Idempotent: create chat + deadline channels early at app boot. */
export function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelsReady) {
    channelsReady = createChannels().catch(() => {
      // Allow a later retry if the first attempt failed.
      channelsReady = null;
    });
  }
  return channelsReady ?? Promise.resolve();
}
