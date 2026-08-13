/**
 * Shared foreground notification handler for chat + deadline reminders.
 * Only one global handler can be registered with expo-notifications; both
 * features must use this helper so neither overwrites the other away.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

let handlerReady = false;

function canUseNotifications(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Show banners/sound for remote chat pushes and local deadline reminders. */
export function ensureForegroundNotificationHandler(): void {
  if (!canUseNotifications()) return;
  // Re-apply every call so late module imports cannot leave a stale handler.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  handlerReady = true;
}

export function isForegroundNotificationHandlerReady(): boolean {
  return handlerReady;
}
