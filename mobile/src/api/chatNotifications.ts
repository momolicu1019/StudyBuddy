/**
 * Local OS notifications + native FCM token helpers for student chat.
 *
 * Remote closed-app chat push is delivered by a Firebase Cloud Function
 * (Admin SDK → FCM), not Expo Push Service. This module still uses
 * expo-notifications for permission, Android channels, foreground banners,
 * notification taps, and local reminders.
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

/** Conversation the user is currently viewing — skip local banners for it. */
let activeConversationId: string | null = null;

/** Recent local/remote keys to avoid double-notifying within a short window. */
const recentNotifyKeys = new Map<string, number>();
const DEDUPE_MS = 20_000;
let suppressorReady = false;

/** Last remote-push delivery problem (for a short toast on the sender). */
let lastPushDeliveryError: string | null = null;

export function consumeLastPushDeliveryError(): string | null {
  const value = lastPushDeliveryError;
  lastPushDeliveryError = null;
  return value;
}

export function peekLastPushDeliveryError(): string | null {
  return lastPushDeliveryError;
}

function setLastPushDeliveryError(message: string | null): void {
  lastPushDeliveryError = message ? String(message).slice(0, 180) : null;
}

/** Used by chatApi when persisting tokens fails. */
export function reportChatPushDeliveryError(message: string): void {
  setLastPushDeliveryError(message);
}

export type ChatNotificationData = {
  type: typeof DATA_TYPE;
  conversationId: string;
  peerName: string;
  peerEmail: string;
  isGroup: boolean;
};

/** String-only payload for FCM/APNs data (non-strings can break Android delivery). */
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

/**
 * Get the native Android FCM registration token.
 *
 * This does NOT contact Expo Push Service.
 */
export async function getCurrentNativeFcmToken(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  try {
    const granted = await ensurePermissionsAndChannel();
    if (!granted) {
      return null;
    }

    const deviceToken =
      await Notifications.getDevicePushTokenAsync();

    if (String(deviceToken.type).toLowerCase() !== 'android') {
      return null;
    }

    const value = String(deviceToken.data || '').trim();

    return value || null;
  } catch (error) {
    setLastPushDeliveryError(
      error instanceof Error
        ? `FCM token error: ${error.message}`
        : 'Could not get FCM token.',
    );

    return null;
  }
}

export type ChatPushDiagnosis = {
  permission: 'granted' | 'denied' | 'undetermined' | 'unknown';
  hasNativeToken: boolean;
  /** Native FCM (Android) registration token. */
  fcmToken: string | null;
  isExpoGo: boolean;
  error: string | null;
};

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${label} timed out after ${Math.round(ms / 1000)}s.`,
            ),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function explainFcmTokenError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/timed out|TIMEOUT/i.test(raw)) {
    return (
      'FCM token timed out. Check internet, Google Play Services, ' +
      'notification permission, and that this APK includes google-services.json, then tap Test again.'
    );
  }
  if (/NETWORK|UNAVAILABLE|Failed to connect|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return 'Network error while fetching the FCM token. Switch networks and retry.';
  }
  if (raw) return `FCM token failed: ${raw}`;
  return 'FCM token failed.';
}

/**
 * Diagnostic: permissions + native FCM device token.
 * Does not contact Expo Push Service.
 */
export async function diagnosePushNotifications(): Promise<
  Record<string, unknown>
> {
  const results: Record<string, unknown> = {};

  try {
    results.platform = {
      os: Platform.OS,
      version: Platform.Version,
    };
  } catch (error) {
    results.platform = {
      error: String(error),
    };
  }

  try {
    const permissions = await Notifications.getPermissionsAsync();

    results.permissions = {
      status: permissions.status,
      granted: permissions.granted,
      canAskAgain: permissions.canAskAgain,
    };
  } catch (error) {
    results.permissions = {
      error: String(error),
    };
  }

  try {
    const deviceToken = await Notifications.getDevicePushTokenAsync();

    results.fcm = {
      success: true,
      type: deviceToken.type,
      tokenLength: deviceToken.data?.length ?? 0,
      tokenPreview: deviceToken.data
        ? `${String(deviceToken.data).substring(0, 8)}...`
        : '',
    };
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      message?: string;
      code?: string;
      stack?: string;
    };
    results.fcm = {
      success: false,
      name: err?.name,
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    };
  }

  return results;
}

/** Short human summary of diagnosePushNotifications() for toasts / push panel. */
export function summarizePushDiagnostic(
  results: Record<string, unknown>,
): string {
  const lines: string[] = [];

  const permissions = results.permissions as
    | { status?: string; granted?: boolean; error?: string }
    | undefined;
  if (permissions?.error) {
    lines.push(`Permissions ❌ ${permissions.error}`);
  } else if (permissions) {
    lines.push(
      `Permissions ${permissions.granted || permissions.status === 'granted' ? '✅' : '❌'} ${permissions.status ?? ''}`,
    );
  }

  const fcm = results.fcm as
    | {
        success?: boolean;
        type?: string;
        message?: string;
        name?: string;
        code?: string;
      }
    | undefined;
  if (fcm?.success) {
    lines.push(`FCM token ✅ ${fcm.type ?? 'ok'}`);
  } else {
    lines.push(
      `FCM token ❌ ${[fcm?.name, fcm?.code, fcm?.message].filter(Boolean).join(': ') || 'failed'}`,
    );
  }

  return lines.join('\n');
}

/** Inspect whether this install can receive closed-app FCM chat pushes. */
export async function diagnoseChatPush(): Promise<ChatPushDiagnosis> {
  const isExpoGo = Constants.appOwnership === 'expo';

  if (!canUsePush()) {
    return {
      permission: 'unknown',
      hasNativeToken: false,
      fcmToken: null,
      isExpoGo,
      error: 'Push is only available on iOS/Android builds.',
    };
  }

  if (isExpoGo) {
    return {
      permission: 'unknown',
      hasNativeToken: false,
      fcmToken: null,
      isExpoGo: true,
      error:
        'Expo Go cannot deliver closed-app chat push. Install the StudyBuddy APK.',
    };
  }

  try {
    await ensureNotificationChannels();

    const current = await Notifications.getPermissionsAsync();

    const permission =
      current.status === 'granted' ||
      current.status === 'denied' ||
      current.status === 'undetermined'
        ? current.status
        : 'unknown';

    if (permission !== 'granted') {
      return {
        permission,
        hasNativeToken: false,
        fcmToken: null,
        isExpoGo: false,
        error: 'Notification permission is not granted.',
      };
    }

    try {
      const fcmToken = await withTimeout(
        getCurrentNativeFcmToken(),
        20_000,
        'FCM token',
      );

      return {
        permission,
        hasNativeToken: Boolean(fcmToken),
        fcmToken,
        isExpoGo: false,
        error: fcmToken
          ? null
          : 'Could not obtain an FCM token on this device.',
      };
    } catch (e) {
      return {
        permission,
        hasNativeToken: false,
        fcmToken: null,
        isExpoGo: false,
        error: explainFcmTokenError(e),
      };
    }
  } catch (e) {
    return {
      permission: 'unknown',
      hasNativeToken: false,
      fcmToken: null,
      isExpoGo: false,
      error:
        e instanceof Error ? e.message : 'Push diagnosis failed.',
    };
  }
}

/**
 * Verify native FCM registration for THIS device and save it to Firestore.
 * Closed-app delivery is handled by the Cloud Function (not Expo Push).
 */
export async function sendSelfTestChatPush(
  knownToken?: string | null,
): Promise<PushSendResult> {
  let fcmToken = String(knownToken || '').trim();

  if (!fcmToken) {
    const diagnosis = await diagnoseChatPush();

    if (!diagnosis.fcmToken) {
      const deliveryError =
        diagnosis.error || 'No FCM token on this device.';

      setLastPushDeliveryError(deliveryError);

      return {
        badTokens: [],
        deliveryError,
        accepted: 0,
      };
    }

    fcmToken = diagnosis.fcmToken;
  }

  try {
    const { registerChatPushForCurrentUser } =
      await import('./chatApi');

    const saved =
      await registerChatPushForCurrentUser(fcmToken);

    if (!saved) {
      const deliveryError =
        consumeLastPushDeliveryError() ||
        'Got an FCM token but could not save it to Firestore.';

      setLastPushDeliveryError(deliveryError);

      return {
        badTokens: [],
        deliveryError,
        accepted: 0,
      };
    }
  } catch (e) {
    const deliveryError =
      e instanceof Error
        ? e.message
        : 'Could not save FCM token to Firestore.';
    setLastPushDeliveryError(deliveryError);
    return { badTokens: [], deliveryError, accepted: 0 };
  }

  // Local smoke test — proves channels + handler without Expo Push Service.
  try {
    await presentLocalChatNotification({
      conversationId: 'push-self-test',
      title: 'StudyBuddy FCM ready',
      body:
        'FCM token saved. Force-close the app, then have a classmate message you.',
      peerName: 'Push test',
      peerEmail: '',
      isGroup: false,
    });
  } catch {
    // ignore local banner failures
  }

  setLastPushDeliveryError(null);
  return {
    badTokens: [],
    deliveryError: null,
    accepted: 1,
  };
}

/** Register for remote push and return the native FCM token (or null). */
export async function registerChatPushToken(): Promise<string | null> {
  return getCurrentNativeFcmToken();
}

/**
 * Keep chatUsers.fcmTokens in sync when the native device token rotates
 * (common after reinstall / OS updates). Call once while signed in.
 */
export function subscribeChatPushTokenRefresh(
  onToken: (token: string) => void,
): () => void {
  if (!canUsePush()) return () => undefined;
  try {
    const sub = Notifications.addPushTokenListener((token) => {
      const value = String(
        typeof token === 'string'
          ? token
          : (token as { data?: string })?.data || '',
      ).trim();
      if (value) onToken(value);
    });
    return () => {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    };
  } catch {
    return () => undefined;
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
  /** Tokens that should be dropped from the profile (unused for FCM self-test). */
  badTokens: string[];
  /** Human-readable delivery problem (permissions, empty tokens, etc.). */
  deliveryError: string | null;
  /** How many notifications were accepted / confirmed locally. */
  accepted: number;
};

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
