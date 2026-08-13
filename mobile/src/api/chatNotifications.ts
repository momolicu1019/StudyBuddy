/**
 * Expo push notifications for student chat.
 * Tokens are stored on chatUsers; the sender fans out via Expo's push API
 * (no Cloud Functions required).
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { ensureForegroundNotificationHandler } from '../storage/foregroundNotifications';

const CHANNEL_ID = 'chat-messages';
const DATA_TYPE = 'chat';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ChatNotificationData = {
  type: typeof DATA_TYPE;
  conversationId: string;
  peerName: string;
  peerEmail: string;
  isGroup: boolean;
};

/** String-only payload for Expo → FCM/APNs (non-strings can break Android delivery). */
type ChatPushDataPayload = {
  type: typeof DATA_TYPE;
  conversationId: string;
  peerName: string;
  peerEmail: string;
  isGroup: '0' | '1';
};

function canUsePush(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export function ensureChatNotificationHandler(): void {
  ensureForegroundNotificationHandler();
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
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
  }

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

/** Read the current Expo push token without prompting for permission. */
export async function getCurrentChatPushToken(): Promise<string | null> {
  if (!canUsePush()) return null;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') return null;
    const projectId = easProjectId();
    if (!projectId) return null;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
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
    if (!projectId) return null;

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
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

function toPushData(data: ChatNotificationData): ChatPushDataPayload {
  return {
    type: DATA_TYPE,
    conversationId: data.conversationId,
    peerName: data.peerName,
    peerEmail: data.peerEmail,
    isGroup: data.isGroup ? '1' : '0',
  };
}

function truthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** Normalize notification `data` from iOS/Android (often stringified). */
export function parseChatNotificationData(
  raw: unknown,
): ChatNotificationData | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  // Older Android builds sometimes put the payload on `body` as a JSON string.
  if (typeof d.body === 'string' && d.body.trim().startsWith('{')) {
    try {
      const nested = JSON.parse(d.body) as Record<string, unknown>;
      if (nested.type === DATA_TYPE || nested.conversationId) {
        return parseChatNotificationData(nested);
      }
    } catch {
      // fall through
    }
  }

  const conversationId = String(d.conversationId || '').trim();
  if (d.type !== DATA_TYPE || !conversationId) return null;

  return {
    type: DATA_TYPE,
    conversationId,
    peerName: String(d.peerName || 'Chat'),
    peerEmail: String(d.peerEmail || ''),
    isGroup: truthyFlag(d.isGroup),
  };
}

export type PushSendResult = {
  /** Tokens Expo reported as DeviceNotRegistered / invalid. */
  badTokens: string[];
};

/** Fan-out Expo push notifications to recipient tokens (best-effort). */
export async function sendChatPushNotifications(input: {
  tokens: string[];
  title: string;
  body: string;
  data: ChatNotificationData;
}): Promise<PushSendResult> {
  const tokens = Array.from(
    new Set(
      (input.tokens || [])
        .map((t) => String(t || '').trim())
        .filter(Boolean),
    ),
  );
  if (tokens.length === 0) return { badTokens: [] };

  const data = toPushData(input.data);
  const messages = tokens.map((to) => ({
    to,
    sound: 'default' as const,
    title: input.title,
    body: input.body.slice(0, 180),
    data,
    channelId: CHANNEL_ID,
    priority: 'high' as const,
  }));

  const badTokens: string[] = [];

  try {
    // Expo accepts a single object or an array of up to 100 messages.
    const chunkSize = 100;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk.length === 1 ? chunk[0] : chunk),
      });

      if (!response.ok) continue;

      const payload = (await response.json()) as {
        data?: Array<{
          status?: string;
          message?: string;
          details?: { error?: string };
        }>;
      };

      const tickets = Array.isArray(payload.data)
        ? payload.data
        : payload.data
          ? [payload.data]
          : [];

      tickets.forEach((ticket, index) => {
        if (!ticket || ticket.status !== 'error') return;
        const err = ticket.details?.error || ticket.message || '';
        if (
          /DeviceNotRegistered|InvalidCredentials|InvalidProviderToken/i.test(
            err,
          )
        ) {
          const token = chunk[index]?.to;
          if (token) badTokens.push(token);
        }
      });
    }
  } catch {
    // Never block sending a chat message on push delivery.
  }

  return { badTokens: Array.from(new Set(badTokens)) };
}

export function isChatNotificationResponse(
  data: unknown,
): data is ChatNotificationData {
  return parseChatNotificationData(data) != null;
}
