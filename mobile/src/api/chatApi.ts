/**
 * Student 1:1 chat via Firebase Auth + Cloud Firestore.
 * Study data stays on-device; only DMs use Firebase.
 */

import {
  EmailAuthProvider,
  User,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import * as Crypto from 'expo-crypto';

import {
  getFirebaseAuth,
  getFirestoreDb,
  isFirebaseConfigured,
} from './firebaseApp';

export type ChatUser = {
  id: string;
  email: string;
  name: string;
};

export type ChatConversation = {
  id: string;
  peer: ChatUser;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type UserDoc = {
  email: string;
  name: string;
  localAuthId: string;
  updatedAt?: unknown;
};

type ConversationDoc = {
  memberIds: string[];
  members: Record<string, { email: string; name: string }>;
  lastMessage: string | null;
  lastMessageAt: Timestamp | null;
  unread: Record<string, number>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Stable password so StudyBuddy accounts map to Firebase email auth. */
async function chatPasswordFor(localAuthId: string): Promise<string> {
  const pepper = (
    process.env.EXPO_PUBLIC_FIREBASE_CHAT_PEPPER || 'studybuddy-chat'
  ).trim();
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${pepper}:${localAuthId}`,
  );
  return `sb_${digest.slice(0, 48)}`;
}

function conversationIdFor(a: string, b: string): string {
  return [a, b].sort().join('_');
}

function tsToIso(value: Timestamp | null | undefined): string | null {
  if (!value) return null;
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

function firebaseErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: unknown }).code || '');
  }
  return '';
}

function firebaseErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err || 'Unknown Firebase error');
}

/** Map Firestore / Auth failures to actionable app errors. */
function mapChatError(err: unknown, fallback: string): Error {
  const code = firebaseErrorCode(err);
  const message = firebaseErrorMessage(err);
  if (
    code === 'permission-denied' ||
    /missing or insufficient permissions/i.test(message)
  ) {
    return new Error(
      'Chat permission denied. In Firebase Console → Firestore → Rules, paste mobile/firestore.rules and Publish, then try again.',
    );
  }
  if (code === 'unavailable' || /network/i.test(message)) {
    return new Error('Chat is offline. Check your connection and try again.');
  }
  if (err instanceof Error) return err;
  return new Error(fallback);
}

export function isChatApiConfigured(): boolean {
  return isFirebaseConfigured();
}

function waitForAuthUser(): Promise<User | null> {
  const auth = getFirebaseAuth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

async function ensureFirebaseUser(input: {
  email: string;
  name: string;
  localAuthId: string;
}): Promise<User> {
  const auth = getFirebaseAuth();
  const email = normalizeEmail(input.email);
  const password = await chatPasswordFor(input.localAuthId);

  // Prefer email/password so the same StudyBuddy account maps across devices.
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (input.name && cred.user.displayName !== input.name) {
      await updateProfile(cred.user, { displayName: input.name });
    }
    return cred.user;
  } catch (signInErr: unknown) {
    const code =
      signInErr && typeof signInErr === 'object' && 'code' in signInErr
        ? String((signInErr as { code: string }).code)
        : '';

    if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
      try {
        const created = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        await updateProfile(created.user, { displayName: input.name });
        return created.user;
      } catch (createErr: unknown) {
        const createCode =
          createErr && typeof createErr === 'object' && 'code' in createErr
            ? String((createErr as { code: string }).code)
            : '';
        // Email exists with a different password — fall through to anonymous + link attempt.
        if (createCode !== 'auth/email-already-in-use') throw createErr;
      }
    } else if (code && code !== 'auth/wrong-password') {
      // Network / config errors should surface.
      if (
        code !== 'auth/invalid-email' &&
        code !== 'auth/too-many-requests' &&
        !code.includes('network')
      ) {
        // continue to anonymous fallback for older anonymous sessions
      } else {
        throw signInErr;
      }
    }
  }

  // Fallback: anonymous session, then try to link email credential.
  let user = auth.currentUser ?? (await waitForAuthUser());
  if (!user) {
    const anon = await signInAnonymously(auth);
    user = anon.user;
  }
  if (user.isAnonymous) {
    try {
      const linked = await linkWithCredential(
        user,
        EmailAuthProvider.credential(email, password),
      );
      user = linked.user;
      await updateProfile(user, { displayName: input.name });
    } catch {
      // Keep anonymous uid if link fails (email already linked elsewhere).
      if (input.name && user.displayName !== input.name) {
        await updateProfile(user, { displayName: input.name });
      }
    }
  }
  return user;
}

async function upsertProfile(user: User, input: {
  email: string;
  name: string;
  localAuthId: string;
}): Promise<ChatUser> {
  const db = getFirestoreDb();
  const email = normalizeEmail(input.email);
  const userRef = doc(db, 'chatUsers', user.uid);
  const emailRef = doc(db, 'chatEmails', email);

  const existingEmail = await getDoc(emailRef);
  if (existingEmail.exists()) {
    const ownerUid = String(existingEmail.data()?.uid || '');
    if (ownerUid && ownerUid !== user.uid) {
      throw new Error(
        'That email is already linked to another chat account. Sign in with the same Study Buddy account on this device.',
      );
    }
  }

  const batch = writeBatch(db);
  batch.set(
    userRef,
    {
      email,
      name: input.name.trim() || email,
      localAuthId: input.localAuthId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  batch.set(emailRef, { uid: user.uid, email }, { merge: true });
  await batch.commit();

  return {
    id: user.uid,
    email,
    name: input.name.trim() || email,
  };
}

export async function clearChatSession(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    await signOut(getFirebaseAuth());
  } catch {
    // ignore
  }
}

export async function upsertChatUser(input: {
  email: string;
  name: string;
  localAuthId: string;
}): Promise<ChatUser> {
  if (!isChatApiConfigured()) {
    throw new Error(
      'Firebase chat is not configured. Add EXPO_PUBLIC_FIREBASE_* to mobile/.env',
    );
  }
  try {
    const user = await ensureFirebaseUser(input);
    return await upsertProfile(user, input);
  } catch (err) {
    throw mapChatError(err, 'Could not set up chat profile');
  }
}

export async function ensureChatSession(user: {
  email: string;
  name: string;
  id: string;
}): Promise<ChatUser> {
  return upsertChatUser({
    email: user.email,
    name: user.name,
    localAuthId: user.id,
  });
}

export async function getMe(): Promise<ChatUser> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser ?? (await waitForAuthUser());
  if (!user) throw new Error('Not signed in to chat');
  const snap = await getDoc(doc(getFirestoreDb(), 'chatUsers', user.uid));
  if (!snap.exists()) {
    throw new Error('Chat profile missing');
  }
  const data = snap.data() as UserDoc;
  return {
    id: user.uid,
    email: data.email,
    name: data.name,
  };
}

async function requireUid(): Promise<string> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser ?? (await waitForAuthUser());
  if (!user) throw new Error('Not signed in to chat');
  return user.uid;
}

export async function listConversations(): Promise<ChatConversation[]> {
  try {
    const uid = await requireUid();
    const db = getFirestoreDb();
    const q = query(
      collection(db, 'chatConversations'),
      where('memberIds', 'array-contains', uid),
    );
    const snap = await getDocs(q);
    const rows: ChatConversation[] = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as ConversationDoc;
      const peerId = (data.memberIds || []).find((id) => id !== uid);
      if (!peerId) continue;
      const peer = data.members?.[peerId] || {
        email: 'unknown',
        name: 'Student',
      };
      rows.push({
        id: docSnap.id,
        peer: { id: peerId, email: peer.email, name: peer.name },
        last_message: data.lastMessage ?? null,
        last_message_at: tsToIso(data.lastMessageAt),
        unread_count: Number(data.unread?.[uid] || 0),
      });
    }
    rows.sort((a, b) => {
      const at = a.last_message_at || '';
      const bt = b.last_message_at || '';
      return bt.localeCompare(at);
    });
    return rows;
  } catch (err) {
    throw mapChatError(err, 'Could not load conversations');
  }
}

export async function openDm(peerEmailRaw: string): Promise<ChatConversation> {
  try {
    const uid = await requireUid();
    const db = getFirestoreDb();
    const peerEmail = normalizeEmail(peerEmailRaw);
    if (!peerEmail) throw new Error('Enter a classmate’s email');

    const meSnap = await getDoc(doc(db, 'chatUsers', uid));
    if (!meSnap.exists()) {
      throw new Error('Chat profile missing — reopen Messages');
    }
    const me = meSnap.data() as UserDoc;
    if (peerEmail === me.email) {
      throw new Error('Cannot start a chat with yourself');
    }

    const emailSnap = await getDoc(doc(db, 'chatEmails', peerEmail));
    if (!emailSnap.exists()) {
      throw new Error(
        'No Study Buddy chat account found for that email. They need to open Messages once first.',
      );
    }
    const peerUid = String(emailSnap.data()?.uid || '');
    if (!peerUid) throw new Error('Invalid chat user for that email');

    const peerSnap = await getDoc(doc(db, 'chatUsers', peerUid));
    const peerData = peerSnap.exists()
      ? (peerSnap.data() as UserDoc)
      : { email: peerEmail, name: peerEmail, localAuthId: '' };

    const id = conversationIdFor(uid, peerUid);
    const convRef = doc(db, 'chatConversations', id);
    let alreadyExists = false;
    try {
      const existing = await getDoc(convRef);
      alreadyExists = existing.exists();
    } catch (readErr) {
      // Older rules denied get on missing docs (`resource` is null), which
      // surfaced as "Missing or insufficient permissions" when starting a DM.
      // Treat that as "does not exist" and attempt create.
      const code = firebaseErrorCode(readErr);
      const message = firebaseErrorMessage(readErr);
      if (
        code !== 'permission-denied' &&
        !/missing or insufficient permissions/i.test(message)
      ) {
        throw readErr;
      }
      alreadyExists = false;
    }

    if (!alreadyExists) {
      const memberIds = [uid, peerUid].sort();
      const payload: ConversationDoc = {
        memberIds,
        members: {
          [uid]: { email: me.email, name: me.name },
          [peerUid]: { email: peerData.email, name: peerData.name },
        },
        lastMessage: null,
        lastMessageAt: null,
        unread: { [uid]: 0, [peerUid]: 0 },
      };
      // create-only semantics: rules allow create; if a race created it, re-read.
      try {
        await setDoc(convRef, payload);
      } catch (createErr) {
        const again = await getDoc(convRef);
        if (!again.exists()) throw createErr;
      }
    }

    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) {
      throw new Error('Could not create conversation');
    }
    const conv = convSnap.data() as ConversationDoc;
    return {
      id,
      peer: {
        id: peerUid,
        email: peerData.email,
        name: peerData.name,
      },
      last_message: conv.lastMessage ?? null,
      last_message_at: tsToIso(conv.lastMessageAt),
      unread_count: Number(conv.unread?.[uid] || 0),
    };
  } catch (err) {
    throw mapChatError(err, 'Could not start chat');
  }
}

export async function listMessages(
  conversationId: string,
  opts?: { afterId?: string; limit?: number },
): Promise<ChatMessage[]> {
  try {
    const uid = await requireUid();
    const db = getFirestoreDb();
    const convRef = doc(db, 'chatConversations', conversationId);
    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) throw new Error('Conversation not found');
    const conv = convSnap.data() as ConversationDoc;
    if (!(conv.memberIds || []).includes(uid)) {
      throw new Error('Not a member of this conversation');
    }

    const take = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
    const q = query(
      collection(db, 'chatConversations', conversationId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(take),
    );
    const snap = await getDocs(q);
    let rows = snap.docs.map((d) => {
      const data = d.data() as {
        senderId: string;
        body: string;
        createdAt?: Timestamp;
      };
      return {
        id: d.id,
        conversation_id: conversationId,
        sender_id: data.senderId,
        body: data.body,
        created_at: tsToIso(data.createdAt) || new Date().toISOString(),
      } satisfies ChatMessage;
    });

    if (opts?.afterId) {
      const idx = rows.findIndex((m) => m.id === opts.afterId);
      rows = idx >= 0 ? rows.slice(idx + 1) : rows;
    }

    // Mark as read when loading the thread.
    if (!opts?.afterId) {
      try {
        await updateDoc(convRef, { [`unread.${uid}`]: 0 });
      } catch {
        // ignore
      }
    }

    return rows;
  } catch (err) {
    throw mapChatError(err, 'Could not load messages');
  }
}

export async function sendMessage(
  conversationId: string,
  bodyRaw: string,
): Promise<ChatMessage> {
  try {
    const uid = await requireUid();
    const body = bodyRaw.trim();
    if (!body) throw new Error('Message cannot be empty');
    if (body.length > 4000) throw new Error('Message is too long');

    const db = getFirestoreDb();
    const convRef = doc(db, 'chatConversations', conversationId);
    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) throw new Error('Conversation not found');
    const conv = convSnap.data() as ConversationDoc;
    if (!(conv.memberIds || []).includes(uid)) {
      throw new Error('Not a member of this conversation');
    }

    const messageRef = doc(
      collection(db, 'chatConversations', conversationId, 'messages'),
    );
    const createdAt = Timestamp.now();
    const batch = writeBatch(db);
    batch.set(messageRef, {
      senderId: uid,
      body,
      createdAt,
    });

    const unreadUpdate: Record<string, number> = { ...(conv.unread || {}) };
    for (const memberId of conv.memberIds || []) {
      if (memberId === uid) unreadUpdate[memberId] = 0;
      else unreadUpdate[memberId] = Number(unreadUpdate[memberId] || 0) + 1;
    }
    batch.update(convRef, {
      lastMessage: body.slice(0, 200),
      lastMessageAt: createdAt,
      unread: unreadUpdate,
    });
    await batch.commit();

    return {
      id: messageRef.id,
      conversation_id: conversationId,
      sender_id: uid,
      body,
      created_at: createdAt.toDate().toISOString(),
    };
  } catch (err) {
    throw mapChatError(err, 'Could not send message');
  }
}

/** Live message subscription (replaces polling when used). */
export function subscribeMessages(
  conversationId: string,
  onChange: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = getFirestoreDb();
  const q = query(
    collection(db, 'chatConversations', conversationId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as {
          senderId: string;
          body: string;
          createdAt?: Timestamp;
        };
        return {
          id: d.id,
          conversation_id: conversationId,
          sender_id: data.senderId,
          body: data.body,
          created_at: tsToIso(data.createdAt) || new Date().toISOString(),
        } satisfies ChatMessage;
      });
      onChange(rows);
    },
    (err) => onError?.(err),
  );
}
