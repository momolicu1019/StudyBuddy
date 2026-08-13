/**
 * Local chat banners driven by Firestore conversation updates.
 *
 * When this device's app process is alive (foreground or backgrounded), new
 * unread from classmates triggers a local OS notification — same delivery
 * path as deadline reminders, so it works even when Expo→FCM remote push is
 * misconfigured. Remote Expo push still runs from the sender for killed apps.
 */

import {
  subscribeConversations,
  type ChatConversation,
} from './chatApi';
import {
  chatNotificationTitle,
  ensureChatNotificationHandler,
  getActiveChatConversationId,
  presentLocalChatNotification,
} from './chatNotifications';

type UnreadSnapshot = Map<string, number>;

let startedForUid: string | null = null;
let unsubscribe: (() => void) | null = null;
let lastUnread: UnreadSnapshot | null = null;

function conversationNotifyMeta(conv: ChatConversation): {
  peerName: string;
  peerEmail: string;
  isGroup: boolean;
} {
  const isGroup = conv.type === 'group';
  return {
    peerName: conv.title || conv.peer.name || 'Chat',
    peerEmail: conv.peer.email || '',
    isGroup,
  };
}

function handleConversations(rows: ChatConversation[]): void {
  const next: UnreadSnapshot = new Map();
  for (const conv of rows) {
    next.set(conv.id, Number(conv.unread_count || 0));
  }

  // First snapshot only seeds baseline — don't notify for pre-existing unread.
  if (!lastUnread) {
    lastUnread = next;
    return;
  }

  const activeId = getActiveChatConversationId();

  for (const conv of rows) {
    const prev = lastUnread.get(conv.id) || 0;
    const cur = Number(conv.unread_count || 0);
    if (cur <= prev) continue;
    if (activeId && activeId === conv.id) continue;
    void presentLocalChatNotification({
      conversationId: conv.id,
      title: chatNotificationTitle(
        conv.title || conv.peer.name || 'Chat',
        prev,
      ),
      body: (conv.last_message || 'New message').trim() || 'New message',
      ...conversationNotifyMeta(conv),
    });
  }

  lastUnread = next;
}

/** Start (or restart) the local incoming-chat watcher for the signed-in user. */
export function startChatIncomingWatcher(uid: string): void {
  const id = String(uid || '').trim();
  if (!id) {
    stopChatIncomingWatcher();
    return;
  }
  if (startedForUid === id && unsubscribe) return;

  stopChatIncomingWatcher();
  ensureChatNotificationHandler();
  startedForUid = id;
  lastUnread = null;
  unsubscribe = subscribeConversations(
    (rows) => handleConversations(rows),
    () => {
      // Keep the last baseline; a later successful snapshot can resume.
    },
  );
}

export function stopChatIncomingWatcher(): void {
  unsubscribe?.();
  unsubscribe = null;
  startedForUid = null;
  lastUnread = null;
}
