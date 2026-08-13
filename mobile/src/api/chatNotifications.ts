/**
 * Expo push + local OS notifications for student chat.
 *
 * Remote path: tokens on chatUsers; sender fans out via Expo's push API.
 * Local path: recipient shows a local banner when Firestore reports new unread
 * while this device's app process is alive (same reliability as deadlines —
 * does not require FCM/APNs). Remote push still covers fully-killed apps when
 * EAS push credentials are configured.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import {
  ensureForegroundNotificationHandler,
  setNotificationSuppressor,
} from '../storage/foregroundNotifications';
import {
  CHAT_CHANNEL_ID,
  ensureNotificationChannels,
} from '../storage/notificationChannels';

const CHANNEL_ID = CHAT_CHANNEL_ID;
const DATA_TYPE = 'chat';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Conversation the user is currently viewing — skip local banners for it. */
let activeConversationId: string | null = null;

/** Recent local/remote keys to avoid double-notifying within a short window. */
const recentNotifyKeys = new Map<string, number>();
const DEDUPE_MS = 20_000;
let suppressorReady = false;

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

function pruneNotifyKeys(now = Date.now()): void {
  for (const [k, at] of recentNotifyKeys) {
    if (now - at > DEDUPE_MS) recentNotifyKeys.delete(k);
  }
}

function wasRecentlyNotified(key: string): boolean {
  pruneNotifyKeys();
  return recentNotifyKeys.has(key);
}

function markNotified(key: string): void {
  pruneNotifyKeys();
  recentNotifyKeys.set(key, Date.now());
}

function chatDedupeKeyFromContent(input: {
  conversationId: string;
  title?: string;
  body?: string;
}): string {
  return `${input.conversationId}|${String(input.body || '').slice(0, 80)}|${String(input.title || '')}`;
}

function installChatDuplicateSuppressor(): void {
  if (suppressorReady) return;
  suppressorReady = true;
  setNotificationSuppressor((notification) => {
    const content = notification.request.content;
    const chat = parseChatNotificationData(content.data);
    if (!chat) return false;
    const key = chatDedupeKeyFromContent({
      conversationId: chat.conversationId,
      title: content.title || undefined,
      body: content.body || undefined,
    });
    if (wasRecentlyNotified(key)) return true;
    markNotified(key);
    return false;
  });
}

export function ensureChatNotificationHandler(): void {
  ensureForegroundNotificationHandler();
  installChatDuplicateSuppressor();
}

export function setActiveChatConversationId(id: string | null): void {
  activeConversationId = id ? String(id).trim() || null : null;
}

export function getActiveChatConversationId(): string | null {
  return activeConversationId;
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
    // Local Firestore-driven banners still notify when the app process is alive.
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
  /** Tokens Expo reported as DeviceNotRegistered (safe to drop). */
  badTokens: string[];
};

async function postExpoPush(
  body: unknown,
): Promise<{
  ok: boolean;
  tickets: Array<{
    status?: string;
    message?: string;
    details?: { error?: string };
  }>;
}> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { ok: false, tickets: [] };
  }

  const payload = (await response.json()) as {
    data?:
      | {
          status?: string;
          message?: string;
          details?: { error?: string };
        }
      | Array<{
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

  return { ok: true, tickets };
}

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
    // Prefer waking the device; ignored on platforms that don't support it.
    _contentAvailable: true,
  }));

  const badTokens: string[] = [];

  try {
    const chunkSize = 100;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      const body = chunk.length === 1 ? chunk[0] : chunk;

      let result = await postExpoPush(body);
      // One quick retry for transient network / 5xx style failures.
      if (!result.ok) {
        await new Promise((r) => setTimeout(r, 400));
        result = await postExpoPush(body);
      }
      if (!result.ok) continue;

      result.tickets.forEach((ticket, index) => {
        if (!ticket || ticket.status !== 'error') return;
        const err = ticket.details?.error || ticket.message || '';
        // Only prune per-device invalid tokens. Project credential errors
        // (InvalidCredentials / InvalidProviderToken) must NOT wipe tokens —
        // those are EAS/FCM setup issues and the same Expo token stays valid.
        if (/DeviceNotRegistered/i.test(err)) {
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

/**
 * Show a local OS notification for an incoming chat message.
 * Used when Firestore reports new unread on this device (app process alive).
 */
export async function presentLocalChatNotification(input: {
  conversationId: string;
  title: string;
  body: string;
  peerName: string;
  peerEmail: string;
  isGroup: boolean;
  /** Optional dedupe key (defaults to conversation + body). */
  dedupeKey?: string;
}): Promise<void> {
  if (!canUsePush()) return;
  const conversationId = String(input.conversationId || '').trim();
  if (!conversationId) return;
  if (activeConversationId && activeConversationId === conversationId) return;

  const dedupeKey =
    input.dedupeKey ||
    chatDedupeKeyFromContent({
      conversationId,
      title: input.title,
      body: input.body,
    });
  // Handler marks keys when the banner is presented — only skip here if a
  // twin (local or remote) already showed moments ago.
  if (wasRecentlyNotified(dedupeKey)) return;

  try {
    const granted = await ensurePermissionsAndChannel();
    if (!granted) return;

    await Notifications.scheduleNotificationAsync({
      identifier: `chat-local-${conversationId}`,
      content: {
        title: input.title,
        body: input.body.slice(0, 180),
        sound: true,
        data: toPushData({
          type: DATA_TYPE,
          conversationId,
          peerName: input.peerName,
          peerEmail: input.peerEmail,
          isGroup: input.isGroup,
        }),
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch {
    // Best-effort local banner.
  }
}

export function isChatNotificationResponse(
  data: unknown,
): data is ChatNotificationData {
  return parseChatNotificationData(data) != null;
}
