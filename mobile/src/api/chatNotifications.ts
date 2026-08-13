/**
 * Expo push notifications for student chat.
 * Tokens are stored on chatUsers; the sender fans out via Expo's push API
 * (no Cloud Functions required).
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'chat-messages';
const DATA_TYPE = 'chat';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

let handlerReady = false;

export type ChatNotificationData = {
  type: typeof DATA_TYPE;
  conversationId: string;
  peerName: string;
  peerEmail: string;
  isGroup: boolean;
};

function canUsePush(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export function ensureChatNotificationHandler(): void {
  if (!canUsePush() || handlerReady) return;
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

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return (
    extra?.eas?.projectId ||
    Constants.easConfig?.projectId ||
    undefined
  );
}

async function ensurePermissionsAndChannel(): Promise<boolean> {
  if (!canUsePush()) return false;
  ensureChatNotificationHandler();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6C63FF',
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

/** Read the current Expo push token without prompting for permission. */
export async function getCurrentChatPushToken(): Promise<string | null> {
  if (!canUsePush()) return null;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') return null;
    const projectId = easProjectId();
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const value = String(token.data || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

/** Register for remote push and return the Expo push token (or null). */
export async function registerChatPushToken(): Promise<string | null> {
  if (!canUsePush()) return null;
  try {
    const granted = await ensurePermissionsAndChannel();
    if (!granted) return null;

    const projectId = easProjectId();
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const value = String(token.data || '').trim();
    return value || null;
  } catch {
    // Simulator / Expo Go / missing credentials — chat still works without push.
    return null;
  }
}

export function chatNotificationTitle(
  fromLabel: string,
  unreadBefore: number,
): string {
  const label = fromLabel.trim() || 'Study Buddy';
  const word = unreadBefore >= 1 ? 'messages' : 'message';
  return `New ${word} from ${label}`;
}

/** Fan-out Expo push notifications to recipient tokens (best-effort). */
export async function sendChatPushNotifications(input: {
  tokens: string[];
  title: string;
  body: string;
  data: ChatNotificationData;
}): Promise<void> {
  const tokens = Array.from(
    new Set(
      (input.tokens || [])
        .map((t) => String(t || '').trim())
        .filter(Boolean),
    ),
  );
  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({
    to,
    sound: 'default' as const,
    title: input.title,
    body: input.body.slice(0, 180),
    data: input.data,
    channelId: CHANNEL_ID,
    priority: 'high' as const,
  }));

  try {
    // Expo accepts a single object or an array of up to 100 messages.
    const chunkSize = 100;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
    }
  } catch {
    // Never block sending a chat message on push delivery.
  }
}

export function isChatNotificationResponse(
  data: unknown,
): data is ChatNotificationData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    d.type === DATA_TYPE &&
    typeof d.conversationId === 'string' &&
    d.conversationId.length > 0
  );
}
