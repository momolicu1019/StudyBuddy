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
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

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

/**
 * Read this device's native FCM (Android) / APNs (iOS) registration token.
 * Prompts for notification permission when needed.
 */
export async function getCurrentNativeFcmToken(): Promise<string | null> {
  if (!canUsePush()) return null;

  try {
    const granted = await ensurePermissionsAndChannel();
    if (!granted) {
      setLastPushDeliveryError(
        'Notification permission is off — enable it for closed-app chat alerts.',
      );
      return null;
    }

    const deviceToken = await withTimeout(
      Notifications.getDevicePushTokenAsync(),
      20_000,
      'Native FCM token',
    );

    const value = String(deviceToken?.data || '').trim();
    if (!value) {
      setLastPushDeliveryError(
        'Could not get a native FCM token on this device.',
      );
      return null;
    }

    return value;
  } catch (e) {
    const raw =
      e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    setLastPushDeliveryError(
      raw
        ? `Native FCM token failed: ${raw}`
        : 'Could not get a native FCM token on this device.',
    );
    return null;
  }
}

export type ChatPushDiagnosis = {
  permission: 'granted' | 'denied' | 'undetermined' | 'unknown';
  hasNativeToken: boolean;
  expoToken: string | null;
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

function explainExpoPushError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/UnknownHostException|Unable to resolve host|exp\.host/i.test(raw)) {
    return (
      'This phone cannot reach Expo (DNS failed for exp.host). ' +
      'Switch Wi‑Fi ↔ mobile data, turn off VPN/Private DNS (or set Private DNS to Automatic), ' +
      'forget/rejoin Wi‑Fi, then tap Test again. Without reaching exp.host, closed-app push cannot register.'
    );
  }
  if (/timed out|TIMEOUT/i.test(raw)) {
    return (
      'Expo push token timed out. Check internet, Google Play Services, ' +
      'notification permission, and that this APK includes google-services.json, then tap Test again.'
    );
  }
  if (/NETWORK|UNAVAILABLE|Failed to connect|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return (
      'Network error talking to Expo push servers. Switch networks and retry Test push.'
    );
  }
  if (raw) return `Expo push token failed: ${raw}`;
  return 'Expo push token failed.';
}

/**
 * Temporary deep diagnostic: tests FCM device token and Expo push token
 * separately so we can see the real Android/Expo error (not a generic timeout).
 * Does not replace the normal registration path.
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

  // Temporary: plain JS fetch to exp.host — isolates APK networking vs Expo-token impl.
  try {
    const response = await fetch('https://exp.host', {
      method: 'GET',
    });

    results.expHostFetch = {
      success: true,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      message?: string;
      code?: string;
    };
    results.expHostFetch = {
      success: false,
      name: err?.name,
      message: err?.message,
      code: err?.code,
    };
  }

  try {
    const projectId = easProjectId();

    results.expoProject = {
      projectId: projectId || null,
    };

    if (!projectId) {
      throw new Error('Expo project ID is missing');
    }

    const expoToken = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    results.expo = {
      success: true,
      tokenLength: expoToken.data?.length ?? 0,
      tokenPreview: expoToken.data
        ? `${String(expoToken.data).substring(0, 20)}...`
        : '',
    };
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      message?: string;
      code?: string;
      stack?: string;
    };
    results.expo = {
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

  const expoProject = results.expoProject as
    | { projectId?: string | null }
    | undefined;
  lines.push(
    `Project ID ${expoProject?.projectId ? '✅' : '❌'} ${expoProject?.projectId ? String(expoProject.projectId).slice(0, 8) + '…' : 'missing'}`,
  );

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

  const expHostFetch = results.expHostFetch as
    | {
        success?: boolean;
        status?: number;
        statusText?: string;
        message?: string;
        name?: string;
        code?: string;
      }
    | undefined;
  if (expHostFetch?.success) {
    lines.push(
      `exp.host fetch ✅ ${expHostFetch.status ?? ''} ${expHostFetch.statusText ?? ''}`.trim(),
    );
  } else {
    lines.push(
      `exp.host fetch ❌ ${[expHostFetch?.name, expHostFetch?.code, expHostFetch?.message].filter(Boolean).join(': ') || 'failed'}`,
    );
  }

  const expo = results.expo as
    | {
        success?: boolean;
        message?: string;
        name?: string;
        code?: string;
      }
    | undefined;
  if (expo?.success) {
    lines.push('Expo token ✅');
  } else {
    lines.push(
      `Expo token ❌ ${[expo?.name, expo?.code, expo?.message].filter(Boolean).join(': ') || 'failed'}`,
    );
  }

  return lines.join('\n');
}

/** Inspect whether this install can receive closed-app Expo→FCM pushes. */
export async function diagnoseChatPush(): Promise<ChatPushDiagnosis> {
  const isExpoGo = Constants.appOwnership === 'expo';

  if (!canUsePush()) {
    return {
      permission: 'unknown',
      hasNativeToken: false,
      expoToken: null,
      isExpoGo,
      error: 'Push is only available on iOS/Android builds.',
    };
  }

  if (isExpoGo) {
    return {
      permission: 'unknown',
      hasNativeToken: false,
      expoToken: null,
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
        expoToken: null,
        isExpoGo: false,
        error: 'Notification permission is not granted.',
      };
    }

    const projectId = easProjectId();

    if (!projectId) {
      return {
        permission,
        hasNativeToken: false,
        expoToken: null,
        isExpoGo: false,
        error: 'Missing EAS projectId.',
      };
    }

    try {
      // Use Expo Push Service directly.
      // Do not call getDevicePushTokenAsync() first.
      const token = await withTimeout(
        Notifications.getExpoPushTokenAsync({ projectId }),
        20_000,
        'Expo push token',
      );

      const expoToken = String(token.data || '').trim() || null;

      return {
        permission,
        hasNativeToken: Boolean(expoToken),
        expoToken,
        isExpoGo: false,
        error: expoToken
          ? null
          : 'Could not obtain an Expo push token on this device.',
      };
    } catch (e) {
      return {
        permission,
        hasNativeToken: false,
        expoToken: null,
        isExpoGo: false,
        error: explainExpoPushError(e),
      };
    }
  } catch (e) {
    return {
      permission: 'unknown',
      hasNativeToken: false,
      expoToken: null,
      isExpoGo: false,
      error:
        e instanceof Error ? e.message : 'Push diagnosis failed.',
    };
  }
}

/**
 * Send a remote Expo push to THIS device (verifies FCM credentials end-to-end).
 * Prefer passing a known Expo token so we do not request another one.
 */
export async function sendSelfTestChatPush(
  knownToken?: string | null,
): Promise<PushSendResult> {
  let expoToken = String(knownToken || '').trim();

  if (!expoToken) {
    const diagnosis = await diagnoseChatPush();

    if (!diagnosis.expoToken) {
      const deliveryError =
        diagnosis.error || 'No Expo push token on this device.';

      setLastPushDeliveryError(deliveryError);

      return {
        badTokens: [],
        deliveryError,
        accepted: 0,
      };
    }

    expoToken = diagnosis.expoToken;
  }

  try {
    const { registerChatPushForCurrentUser } =
      await import('./chatApi');

    const saved =
      await registerChatPushForCurrentUser(expoToken);

    if (!saved) {
      const deliveryError =
        consumeLastPushDeliveryError() ||
        'Got a push token but could not save it to Firestore.';

      setLastPushDeliveryError(deliveryError);
    }
  } catch {
    // Still attempt the self-test using the token we already have.
  }

  return sendChatPushNotifications({
    tokens: [expoToken],
    title: 'StudyBuddy push test',
    body:
      'If you see this, Expo→FCM works. Force-close the app, then have a classmate message you.',
    data: {
      type: DATA_TYPE,
      conversationId: 'push-self-test',
      peerName: 'Push test',
      peerEmail: '',
      isGroup: false,
    },
  });
}

/** Register for remote push and return the Expo push token (or null). */
export async function registerChatPushToken(): Promise<string | null> {
  if (!canUsePush()) return null;

  try {
    const granted = await ensurePermissionsAndChannel();

    if (!granted) {
      setLastPushDeliveryError(
        'Notification permission is off — enable it for closed-app chat alerts.',
      );
      return null;
    }

    const projectId = easProjectId();

    if (!projectId) {
      setLastPushDeliveryError(
        'Missing EAS projectId — cannot register push.',
      );
      return null;
    }

    const token = await withTimeout(
      Notifications.getExpoPushTokenAsync({ projectId }),
      20_000,
      'Expo push token',
    );

    const value = String(token.data || '').trim();

    if (!value) {
      setLastPushDeliveryError(
        'Could not get an Expo push token on this device.',
      );
      return null;
    }

    return value;
  } catch (e) {
    setLastPushDeliveryError(explainExpoPushError(e));
    return null;
  }
}

/**
 * Keep chatUsers.expoPushTokens in sync when Expo rotates the device token
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
  /** Tokens Expo reported as DeviceNotRegistered (safe to drop). */
  badTokens: string[];
  /** Human-readable delivery problem (credentials, empty tokens, etc.). */
  deliveryError: string | null;
  /** How many Expo tickets accepted the message. */
  accepted: number;
};

async function postExpoPush(
  body: unknown,
): Promise<{
  ok: boolean;
  tickets: Array<{
    status?: string;
    id?: string;
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
          id?: string;
          message?: string;
          details?: { error?: string };
        }
      | Array<{
          status?: string;
          id?: string;
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

async function fetchExpoPushReceipts(
  ids: string[],
): Promise<
  Record<
    string,
    {
      status?: string;
      message?: string;
      details?: { error?: string };
    }
  >
> {
  if (ids.length === 0) return {};
  try {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) return {};
    const payload = (await response.json()) as {
      data?: Record<
        string,
        {
          status?: string;
          message?: string;
          details?: { error?: string };
        }
      >;
    };
    return payload.data && typeof payload.data === 'object' ? payload.data : {};
  } catch {
    return {};
  }
}

function describePushError(code: string, fallback?: string): string {
  if (/InvalidCredentials|InvalidProviderToken/i.test(code)) {
    return 'Expo→FCM credentials invalid. Re-upload FCM V1 on EAS and ensure the service account has Firebase Cloud Messaging API Admin.';
  }
  if (/DeviceNotRegistered/i.test(code)) {
    return 'Recipient push token expired — they should open StudyBuddy once on the latest APK.';
  }
  if (/MessageTooBig/i.test(code)) {
    return 'Chat push was too large to deliver.';
  }
  if (/MessageRateExceeded/i.test(code)) {
    return 'Chat push rate-limited by Expo — try again shortly.';
  }
  return fallback || code || 'Chat push delivery failed.';
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
  if (tokens.length === 0) {
    const deliveryError =
      'Recipient has no push token — they must open the latest StudyBuddy APK once while signed in.';
    setLastPushDeliveryError(deliveryError);
    return { badTokens: [], deliveryError, accepted: 0 };
  }

  const data = toPushData(input.data);
  const ttlSeconds = 60 * 60 * 24;
  // Omit channelId so Android can still show the alert if the custom
  // chat-messages channel was wiped (clear-data). Local banners still use
  // CHANNEL_ID. Expo will use/create the default channel for remote pushes.
  const messages = tokens.map((to) => ({
    to,
    sound: 'default' as const,
    title: input.title,
    body: input.body.slice(0, 180),
    data,
    priority: 'high' as const,
    ttl: ttlSeconds,
    expiration: Math.floor(Date.now() / 1000) + ttlSeconds,
  }));

  const badTokens: string[] = [];
  const ticketIds: string[] = [];
  let accepted = 0;
  let deliveryError: string | null = null;

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
      if (!result.ok) {
        deliveryError = 'Could not reach Expo push service.';
        continue;
      }

      result.tickets.forEach((ticket, index) => {
        if (!ticket) return;
        if (ticket.status === 'ok' && ticket.id) {
          accepted += 1;
          ticketIds.push(ticket.id);
          return;
        }
        if (ticket.status !== 'error') return;
        const err = ticket.details?.error || ticket.message || '';
        deliveryError = describePushError(err, ticket.message);
        if (/DeviceNotRegistered/i.test(err)) {
          const token = chunk[index]?.to;
          if (token) badTokens.push(token);
        }
      });
    }

    // Receipts reveal FCM/APNs handoff errors that tickets do not (e.g. InvalidCredentials).
    if (ticketIds.length > 0) {
      await new Promise((r) => setTimeout(r, 1200));
      const receipts = await fetchExpoPushReceipts(ticketIds);
      for (const receipt of Object.values(receipts)) {
        if (!receipt || receipt.status !== 'error') continue;
        const err = receipt.details?.error || receipt.message || '';
        deliveryError = describePushError(err, receipt.message);
        if (/DeviceNotRegistered/i.test(err)) {
          // Receipts are not aligned 1:1 with token index — prune happens on next ticket error.
        }
      }
    }
  } catch {
    // Never block sending a chat message on push delivery.
    deliveryError = deliveryError || 'Chat push failed unexpectedly.';
  }

  if (deliveryError) setLastPushDeliveryError(deliveryError);
  else if (accepted > 0) setLastPushDeliveryError(null);

  return {
    badTokens: Array.from(new Set(badTokens)),
    deliveryError,
    accepted,
  };
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
