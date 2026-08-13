/**
 * Shared foreground notification handler for chat + deadline reminders.
 * Only one global handler can be registered with expo-notifications; both
 * features must use this helper so neither overwrites the other away.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { ensureNotificationChannels } from './notificationChannels';

let handlerReady = false;
let suppressNotification:
  | ((notification: Notifications.Notification) => boolean)
  | null = null;

function canUseNotifications(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Optional hook so chat can suppress duplicate banners when local + remote
 * paths both deliver the same message.
 */
export function setNotificationSuppressor(
  fn: ((notification: Notifications.Notification) => boolean) | null,
): void {
  suppressNotification = fn;
}

/** Show banners/sound for remote chat pushes and local deadline reminders. */
export function ensureForegroundNotificationHandler(): void {
  if (!canUseNotifications()) return;
  // Re-apply every call so late module imports cannot leave a stale handler.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const suppress = suppressNotification?.(notification) === true;
      return {
        shouldPlaySound: !suppress,
        shouldSetBadge: true,
        shouldShowBanner: !suppress,
        shouldShowList: !suppress,
      };
    },
  });
  handlerReady = true;
  // Channels must exist before remote pushes arrive (Android 8+ silent drop).
  void ensureNotificationChannels();
}

export function isForegroundNotificationHandlerReady(): boolean {
  return handlerReady;
}
