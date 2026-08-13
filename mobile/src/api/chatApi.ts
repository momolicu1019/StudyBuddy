/**
 * Student chat (1:1 DMs + group communities) via Firebase Auth + Cloud Firestore.
 * Study data stays on-device; only messaging uses Firebase.
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

const MAX_GROUP_MEMBERS = 20;

export type ChatUser = {
  id: string;
  email: string;
  name: string;
};

export type ChatConversation = {
  id: string;
  type: 'dm' | 'group';
  /** Display title: peer name for DMs, group name for groups. */
  title: string;
  peer: ChatUser;
  members: ChatUser[];
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name?: string;
  body: string;
  created_at: string;
};

type UserDoc = {
  email: string;
  name: string;
  localAuthId: string;
  /** Expo push tokens for this chat user (multi-device). */
  expoPushTokens?: string[];
  updatedAt?: unknown;
};

const MAX_PUSH_TOKENS = 10;

type ConversationDoc = {
  type?: 'dm' | 'group';
  title?: string;
  createdBy?: string;
  memberIds: string[];
  members: Record<string, { email: string; name: string }>;
  lastMessage: string | null;
  lastMessageAt: Timestamp | null;
  unread: Record<string, number>;
  /** Soft-delete: hide this thread from a member's inbox. */
  hiddenFor?: Record<string, boolean>;
};

export type ChatFriend = {
  email: string;
  name: string;
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
    const auth = getFirebaseAuth();
    const uid = auth.currentUser?.uid;
    if (uid) {
      try {
        const { getCurrentChatPushToken } = await import('./chatNotifications');
        const token = await getCurrentChatPushToken();
        if (token) await unregisterChatPushToken(token);
      } catch {
        // ignore push cleanup failures on sign-out
      }
    }
    await signOut(auth);
  } catch {
    // ignore
  }
}

/** Persist this device's Expo push token on the signed-in chat profile. */
export async function registerChatPushForCurrentUser(): Promise<void> {
  if (!isChatApiConfigured()) return;
  try {
    const uid = await requireUid();
    const { registerChatPushToken, ensureChatNotificationHandler } =
      await import('./chatNotifications');
    ensureChatNotificationHandler();
    const token = await registerChatPushToken();
    if (!token) return;

    const userRef = doc(getFirestoreDb(), 'chatUsers', uid);
    const snap = await getDoc(userRef);
    const existing = snap.exists()
      ? ((snap.data() as UserDoc).expoPushTokens || [])
      : [];
    const next = Array.from(new Set([token, ...existing])).slice(
      0,
      MAX_PUSH_TOKENS,
    );
    if (
      next.length === existing.length &&
      next.every((t, i) => t === existing[i])
    ) {
      return;
    }
    // set+merge so token writes still work if the profile doc is partial/missing.
    await setDoc(
      userRef,
      {
        expoPushTokens: next,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    // Push is best-effort — chat still works without it.
  }
}

/** Drop invalid Expo tokens from a chat profile (best-effort). */
async function pruneChatPushTokens(
  memberId: string,
  badTokens: string[],
): Promise<void> {
  const remove = new Set(
    badTokens.map((t) => String(t || '').trim()).filter(Boolean),
  );
  if (remove.size === 0) return;
  try {
    const userRef = doc(getFirestoreDb(), 'chatUsers', memberId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const existing = (snap.data() as UserDoc).expoPushTokens || [];
    const next = existing.filter((t) => !remove.has(t));
    if (next.length === existing.length) return;
    await setDoc(
      userRef,
      { expoPushTokens: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch {
    // ignore prune failures
  }
}

/** Remove a device token from the current chat profile (e.g. on sign-out). */
export async function unregisterChatPushToken(token: string): Promise<void> {
  const value = token.trim();
  if (!value || !isChatApiConfigured()) return;
  try {
    const uid = await requireUid();
    const userRef = doc(getFirestoreDb(), 'chatUsers', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const existing = (snap.data() as UserDoc).expoPushTokens || [];
    const next = existing.filter((t) => t !== value);
    if (next.length === existing.length) return;
    await setDoc(
      userRef,
      {
        expoPushTokens: next,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
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

function membersFromDoc(data: ConversationDoc): ChatUser[] {
  return (data.memberIds || []).map((id) => {
    const m = data.members?.[id];
    return {
      id,
      email: m?.email || 'unknown',
      name: m?.name || 'Student',
    };
  });
}

function mapConversation(
  docSnap: { id: string; data: () => ConversationDoc },
  uid: string,
  opts?: { includeHidden?: boolean },
): ChatConversation | null {
  const data = docSnap.data();
  const memberIds = data.memberIds || [];
  if (!memberIds.includes(uid)) return null;
  if (!opts?.includeHidden && data.hiddenFor?.[uid]) return null;

  const members = membersFromDoc(data);
  const isGroup = data.type === 'group';
  const peerId = memberIds.find((id) => id !== uid);
  const peerMember = peerId
    ? data.members?.[peerId] || { email: 'unknown', name: 'Student' }
    : { email: '', name: data.title || 'Group' };

  const title = isGroup
    ? (data.title || 'Group chat').trim() || 'Group chat'
    : peerMember.name;

  return {
    id: docSnap.id,
    type: isGroup ? 'group' : 'dm',
    title,
    peer: {
      id: peerId || docSnap.id,
      email: isGroup
        ? `${members.length} members`
        : peerMember.email,
      name: title,
    },
    members,
    last_message: data.lastMessage ?? null,
    last_message_at: tsToIso(data.lastMessageAt),
    unread_count: Number(data.unread?.[uid] || 0),
  };
}

function friendsFromConversationDocs(
  docs: Array<{ data: () => ConversationDoc }>,
  uid: string,
  myEmail?: string,
): ChatFriend[] {
  const byEmail = new Map<string, ChatFriend>();
  const selfEmail = myEmail ? normalizeEmail(myEmail) : '';

  for (const docSnap of docs) {
    const data = docSnap.data();
    if (!(data.memberIds || []).includes(uid)) continue;
    for (const [memberId, info] of Object.entries(data.members || {})) {
      if (memberId === uid) continue;
      const email = normalizeEmail(info?.email || '');
      if (!email || email === 'unknown' || (selfEmail && email === selfEmail)) {
        continue;
      }
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          name: (info?.name || email).trim() || email,
        });
      }
    }
  }

  return Array.from(byEmail.values()).sort((a, b) =>
    a.email.localeCompare(b.email),
  );
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
      const mapped = mapConversation(
        { id: docSnap.id, data: () => docSnap.data() as ConversationDoc },
        uid,
      );
      if (mapped) rows.push(mapped);
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

/** Live conversation list (previews + unread) for the signed-in chat user. */
export type ConversationSyncMeta = {
  /** True when this snapshot came from the local Firestore cache. */
  fromCache: boolean;
};

export function subscribeConversations(
  onChange: (
    conversations: ChatConversation[],
    friends: ChatFriend[],
    meta?: ConversationSyncMeta,
  ) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const auth = getFirebaseAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) {
    onChange([], [], { fromCache: false });
    return () => undefined;
  }

  const db = getFirestoreDb();
  const q = query(
    collection(db, 'chatConversations'),
    where('memberIds', 'array-contains', uid),
  );
  // includeMetadataChanges so we can tell cache vs server and avoid a false
  // "new message" banner when the app cold-starts and cache then catches up.
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const rows: ChatConversation[] = [];
      const rawDocs = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        data: () => docSnap.data() as ConversationDoc,
      }));
      for (const docSnap of rawDocs) {
        const mapped = mapConversation(docSnap, uid);
        if (mapped) rows.push(mapped);
      }
      rows.sort((a, b) => {
        const at = a.last_message_at || '';
        const bt = b.last_message_at || '';
        return bt.localeCompare(at);
      });
      onChange(rows, friendsFromConversationDocs(rawDocs, uid), {
        fromCache: snap.metadata.fromCache,
      });
    },
    (err) => onError?.(mapChatError(err, 'Could not sync conversations')),
  );
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
        type: 'dm',
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
    } else {
      // Reopening a previously deleted (hidden) DM restores it in the inbox.
      await clearConversationHidden(convRef.id, uid);
    }

    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) {
      throw new Error('Could not create conversation');
    }
    const mapped = mapConversation(
      { id, data: () => convSnap.data() as ConversationDoc },
      uid,
    );
    if (!mapped) throw new Error('Could not create conversation');
    return mapped;
  } catch (err) {
    throw mapChatError(err, 'Could not start chat');
  }
}

async function resolvePeerByEmail(
  peerEmailRaw: string,
  myEmail: string,
): Promise<{ uid: string; email: string; name: string }> {
  const db = getFirestoreDb();
  const peerEmail = normalizeEmail(peerEmailRaw);
  if (!peerEmail) throw new Error('Enter a classmate’s email');
  if (peerEmail === myEmail) {
    throw new Error('Cannot add yourself — you are already in the chat');
  }

  const emailSnap = await getDoc(doc(db, 'chatEmails', peerEmail));
  if (!emailSnap.exists()) {
    throw new Error(
      `No Study Buddy chat account for ${peerEmail}. They need to open Messages once first.`,
    );
  }
  const peerUid = String(emailSnap.data()?.uid || '');
  if (!peerUid) throw new Error(`Invalid chat user for ${peerEmail}`);

  const peerSnap = await getDoc(doc(db, 'chatUsers', peerUid));
  const peerData = peerSnap.exists()
    ? (peerSnap.data() as UserDoc)
    : { email: peerEmail, name: peerEmail, localAuthId: '' };

  return {
    uid: peerUid,
    email: peerData.email,
    name: peerData.name,
  };
}

/** Create a group chat community with friends (by Study Buddy email). */
export async function createGroupChat(input: {
  title: string;
  memberEmails: string[];
}): Promise<ChatConversation> {
  try {
    const uid = await requireUid();
    const db = getFirestoreDb();
    const title = input.title.trim().replace(/\s+/g, ' ');
    if (!title) throw new Error('Enter a group name');
    if (title.length > 80) throw new Error('Group name is too long');

    const meSnap = await getDoc(doc(db, 'chatUsers', uid));
    if (!meSnap.exists()) {
      throw new Error('Chat profile missing — reopen Messages');
    }
    const me = meSnap.data() as UserDoc;

    const uniqueEmails = Array.from(
      new Set(
        (input.memberEmails || [])
          .map(normalizeEmail)
          .filter(Boolean),
      ),
    );
    if (uniqueEmails.length < 1) {
      throw new Error('Add at least one friend’s email');
    }
    if (uniqueEmails.length + 1 > MAX_GROUP_MEMBERS) {
      throw new Error(`Groups can have at most ${MAX_GROUP_MEMBERS} members`);
    }

    const members: Record<string, { email: string; name: string }> = {
      [uid]: { email: me.email, name: me.name },
    };
    const unread: Record<string, number> = { [uid]: 0 };

    for (const email of uniqueEmails) {
      const peer = await resolvePeerByEmail(email, me.email);
      if (members[peer.uid]) continue;
      members[peer.uid] = { email: peer.email, name: peer.name };
      unread[peer.uid] = 0;
    }

    const memberIds = Object.keys(members).sort();
    if (memberIds.length < 2) {
      throw new Error('Add at least one friend who has opened Messages');
    }

    const convRef = doc(collection(db, 'chatConversations'));
    const payload: ConversationDoc = {
      type: 'group',
      title,
      createdBy: uid,
      memberIds,
      members,
      lastMessage: null,
      lastMessageAt: null,
      unread,
    };
    await setDoc(convRef, payload);

    const mapped = mapConversation(
      { id: convRef.id, data: () => payload },
      uid,
    );
    if (!mapped) throw new Error('Could not create group');
    return mapped;
  } catch (err) {
    throw mapChatError(err, 'Could not create group');
  }
}

/** Rename a group chat. Any member can update the community name. */
export async function updateGroupTitle(
  conversationId: string,
  titleRaw: string,
): Promise<ChatConversation> {
  try {
    const uid = await requireUid();
    const title = titleRaw.trim().replace(/\s+/g, ' ');
    if (!title) throw new Error('Enter a group name');
    if (title.length > 80) throw new Error('Group name is too long');

    const db = getFirestoreDb();
    const convRef = doc(db, 'chatConversations', conversationId);
    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) throw new Error('Conversation not found');
    const conv = convSnap.data() as ConversationDoc;
    if (!(conv.memberIds || []).includes(uid)) {
      throw new Error('Not a member of this conversation');
    }
    if (conv.type !== 'group') {
      throw new Error('Only group chats can be renamed');
    }

    await updateDoc(convRef, { title });
    const mapped = mapConversation(
      {
        id: conversationId,
        data: () => ({ ...conv, title }),
      },
      uid,
    );
    if (!mapped) throw new Error('Could not rename group');
    return mapped;
  } catch (err) {
    throw mapChatError(err, 'Could not rename group');
  }
}

/** Invite classmates into an existing group by Study Buddy email. */
export async function addGroupMembers(
  conversationId: string,
  memberEmails: string[],
): Promise<ChatConversation> {
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
    if (conv.type !== 'group') {
      throw new Error('Only group chats can add members');
    }

    const meSnap = await getDoc(doc(db, 'chatUsers', uid));
    if (!meSnap.exists()) {
      throw new Error('Chat profile missing — reopen Messages');
    }
    const me = meSnap.data() as UserDoc;

    const uniqueEmails = Array.from(
      new Set(
        (memberEmails || []).map(normalizeEmail).filter(Boolean),
      ),
    );
    if (uniqueEmails.length < 1) {
      throw new Error('Add at least one friend’s email');
    }

    const members: Record<string, { email: string; name: string }> = {
      ...(conv.members || {}),
    };
    const unread: Record<string, number> = { ...(conv.unread || {}) };
    const existingIds = new Set(conv.memberIds || []);
    let added = 0;

    for (const email of uniqueEmails) {
      const peer = await resolvePeerByEmail(email, me.email);
      if (existingIds.has(peer.uid) || members[peer.uid]) {
        continue;
      }
      members[peer.uid] = { email: peer.email, name: peer.name };
      unread[peer.uid] = unread[peer.uid] ?? 0;
      existingIds.add(peer.uid);
      added += 1;
    }

    if (added === 0) {
      throw new Error('Those classmates are already in this group');
    }

    const memberIds = Array.from(existingIds).sort();
    if (memberIds.length > MAX_GROUP_MEMBERS) {
      throw new Error(`Groups can have at most ${MAX_GROUP_MEMBERS} members`);
    }

    // Keep members/unread maps aligned with memberIds only.
    const nextMembers: Record<string, { email: string; name: string }> = {};
    const nextUnread: Record<string, number> = {};
    for (const id of memberIds) {
      nextMembers[id] = members[id] || {
        email: 'unknown',
        name: 'Student',
      };
      nextUnread[id] = Number(unread[id] || 0);
    }

    await updateDoc(convRef, {
      memberIds,
      members: nextMembers,
      unread: nextUnread,
    });

    const mapped = mapConversation(
      {
        id: conversationId,
        data: () => ({
          ...conv,
          memberIds,
          members: nextMembers,
          unread: nextUnread,
        }),
      },
      uid,
    );
    if (!mapped) throw new Error('Could not add members');
    return mapped;
  } catch (err) {
    throw mapChatError(err, 'Could not add members');
  }
}

async function clearConversationHidden(
  conversationId: string,
  uid: string,
): Promise<void> {
  const db = getFirestoreDb();
  const convRef = doc(db, 'chatConversations', conversationId);
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) return;
  const conv = convSnap.data() as ConversationDoc;
  if (!conv.hiddenFor?.[uid]) return;
  const nextHidden = { ...(conv.hiddenFor || {}) };
  delete nextHidden[uid];
  await updateDoc(convRef, { hiddenFor: nextHidden });
}

/** Hide a conversation from the current user's inbox (soft-delete). */
export async function hideConversation(conversationId: string): Promise<void> {
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
    await updateDoc(convRef, {
      hiddenFor: { ...(conv.hiddenFor || {}), [uid]: true },
    });
  } catch (err) {
    throw mapChatError(err, 'Could not delete chat');
  }
}

/** Leave a group community — removes you from membership and your inbox. */
export async function leaveGroup(conversationId: string): Promise<void> {
  try {
    const uid = await requireUid();
    const db = getFirestoreDb();
    const convRef = doc(db, 'chatConversations', conversationId);
    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) throw new Error('Conversation not found');
    const conv = convSnap.data() as ConversationDoc;
    if (conv.type !== 'group') {
      throw new Error('Only group chats can be left');
    }
    if (!(conv.memberIds || []).includes(uid)) {
      throw new Error('Not a member of this conversation');
    }

    const memberIds = (conv.memberIds || []).filter((id) => id !== uid);
    const nextMembers: Record<string, { email: string; name: string }> = {};
    const nextUnread: Record<string, number> = {};
    for (const id of memberIds) {
      nextMembers[id] = conv.members?.[id] || {
        email: 'unknown',
        name: 'Student',
      };
      nextUnread[id] = Number(conv.unread?.[id] || 0);
    }

    await updateDoc(convRef, {
      memberIds,
      members: nextMembers,
      unread: nextUnread,
    });
  } catch (err) {
    throw mapChatError(err, 'Could not leave group');
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
        sender_name: conv.members?.[data.senderId]?.name,
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
    // Client timestamp so the sender UI can show the message immediately and
    // remote listeners receive a concrete createdAt (serverTimestamp is null
    // until the write resolves, which can delay remote ordering).
    const createdAt = Timestamp.now();
    const unreadBeforeByMember: Record<string, number> = {};
    const unreadUpdate: Record<string, number> = { ...(conv.unread || {}) };
    for (const memberId of conv.memberIds || []) {
      unreadBeforeByMember[memberId] = Number(unreadUpdate[memberId] || 0);
      if (memberId === uid) unreadUpdate[memberId] = 0;
      else unreadUpdate[memberId] = unreadBeforeByMember[memberId] + 1;
    }

    const batch = writeBatch(db);
    batch.set(messageRef, {
      senderId: uid,
      body,
      createdAt,
    });
    batch.update(convRef, {
      lastMessage: body.slice(0, 200),
      lastMessageAt: createdAt,
      unread: unreadUpdate,
    });
    await batch.commit();

    // Push notify other members (best-effort; never fail the send).
    // Await briefly so the Expo fan-out starts before the JS runtime can be
    // suspended if the sender backgrounds the app right after sending.
    try {
      await Promise.race([
        notifyConversationMembers({
          conversationId,
          conv,
          senderId: uid,
          body,
          unreadBeforeByMember,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ]);
    } catch {
      // ignore push failures
    }

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

async function notifyConversationMembers(input: {
  conversationId: string;
  conv: ConversationDoc;
  senderId: string;
  body: string;
  unreadBeforeByMember: Record<string, number>;
}): Promise<void> {
  try {
    const {
      chatNotificationTitle,
      sendChatPushNotifications,
    } = await import('./chatNotifications');

    const isGroup = input.conv.type === 'group';
    const senderName =
      input.conv.members?.[input.senderId]?.name?.trim() || 'Student';
    const groupTitle =
      (input.conv.title || 'Group chat').trim() || 'Group chat';
    const fromLabel = isGroup ? groupTitle : senderName;
    const peerEmail = isGroup
      ? `${(input.conv.memberIds || []).length} members`
      : input.conv.members?.[input.senderId]?.email || '';

    const recipientIds = (input.conv.memberIds || []).filter(
      (id) => id !== input.senderId,
    );
    if (recipientIds.length === 0) return;

    const db = getFirestoreDb();
    for (const memberId of recipientIds) {
      try {
        const snap = await getDoc(doc(db, 'chatUsers', memberId));
        if (!snap.exists()) continue;
        const memberTokens = (snap.data() as UserDoc).expoPushTokens || [];
        if (memberTokens.length === 0) continue;
        const unreadBefore = Number(
          input.unreadBeforeByMember[memberId] || 0,
        );
        const result = await sendChatPushNotifications({
          tokens: memberTokens,
          title: chatNotificationTitle(fromLabel, unreadBefore),
          body: input.body,
          data: {
            type: 'chat',
            conversationId: input.conversationId,
            peerName: fromLabel,
            peerEmail,
            isGroup,
          },
        });
        if (result.badTokens.length > 0) {
          void pruneChatPushTokens(memberId, result.badTokens);
        }
      } catch {
        // skip members we cannot notify
      }
    }
  } catch {
    // ignore push failures
  }
}

/** Clear unread for the current user while a thread is open. */
export async function markConversationRead(
  conversationId: string,
): Promise<void> {
  try {
    const uid = await requireUid();
    await updateDoc(doc(getFirestoreDb(), 'chatConversations', conversationId), {
      [`unread.${uid}`]: 0,
    });
  } catch {
    // ignore transient unread resets
  }
}

/** Live unread total across all conversations for the current user. */
export function subscribeUnreadTotal(
  onChange: (total: number) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const auth = getFirebaseAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) {
    onChange(0);
    return () => undefined;
  }

  const db = getFirestoreDb();
  const q = query(
    collection(db, 'chatConversations'),
    where('memberIds', 'array-contains', uid),
  );
  return onSnapshot(
    q,
    (snap) => {
      let total = 0;
      for (const docSnap of snap.docs) {
        const data = docSnap.data() as ConversationDoc;
        total += Number(data.unread?.[uid] || 0);
      }
      onChange(total);
    },
    (err) => onError?.(err),
  );
}

/** Live message subscription (replaces polling when used). */
export function subscribeMessages(
  conversationId: string,
  onChange: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = getFirestoreDb();
  let memberNames: Record<string, string> = {};
  let latestRows: ChatMessage[] = [];

  const emit = () => {
    onChange(
      latestRows.map((m) => ({
        ...m,
        sender_name: memberNames[m.sender_id] || m.sender_name,
      })),
    );
  };

  const unsubConv = onSnapshot(
    doc(db, 'chatConversations', conversationId),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as ConversationDoc;
      const next: Record<string, string> = {};
      for (const [id, m] of Object.entries(data.members || {})) {
        next[id] = m.name;
      }
      memberNames = next;
      if (latestRows.length > 0) emit();
    },
    () => {
      // ignore conversation metadata errors
    },
  );

  const q = query(
    collection(db, 'chatConversations', conversationId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200),
  );
  const unsubMsgs = onSnapshot(
    q,
    (snap) => {
      latestRows = snap.docs.map((d) => {
        const data = d.data() as {
          senderId: string;
          body: string;
          createdAt?: Timestamp;
        };
        return {
          id: d.id,
          conversation_id: conversationId,
          sender_id: data.senderId,
          sender_name: memberNames[data.senderId],
          body: data.body,
          created_at: tsToIso(data.createdAt) || new Date().toISOString(),
        } satisfies ChatMessage;
      });
      emit();
    },
    (err) => onError?.(mapChatError(err, 'Could not sync messages')),
  );

  return () => {
    unsubConv();
    unsubMsgs();
  };
}

// ---------------------------------------------------------------------------
// Google Drive chat backup (export / restore)
// ---------------------------------------------------------------------------

export type ChatBackupMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export type ChatBackupConversation = {
  id: string;
  type: 'dm' | 'group';
  title?: string;
  createdBy?: string;
  memberIds: string[];
  members: Record<string, { email: string; name: string }>;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: Record<string, number>;
  messages: ChatBackupMessage[];
};

export type ChatBackupPayload = {
  version: 1;
  exportedAt: string;
  /** Firebase uid that owned this export (may be remapped on restore). */
  firebaseUid: string;
  conversations: ChatBackupConversation[];
};

export type ChatBackupRestoreResult = {
  conversations: number;
  messages: number;
};

const MAX_BACKUP_MESSAGES_PER_CONV = 200;

function remapUid(id: string, fromUid: string, toUid: string): string {
  if (!fromUid || fromUid === toUid) return id;
  return id === fromUid ? toUid : id;
}

function remapDmConversationId(
  conversationId: string,
  fromUid: string,
  toUid: string,
): string {
  if (!fromUid || fromUid === toUid) return conversationId;
  const parts = conversationId.split('_');
  if (parts.length !== 2) return conversationId;
  if (parts[0] !== fromUid && parts[1] !== fromUid) return conversationId;
  return [remapUid(parts[0], fromUid, toUid), remapUid(parts[1], fromUid, toUid)]
    .sort()
    .join('_');
}

function isoToTimestamp(iso: string | null | undefined): Timestamp | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Timestamp.fromMillis(ms);
}

/** Export this user's conversations + recent messages for Drive sync. */
export async function exportChatBackup(): Promise<ChatBackupPayload | null> {
  if (!isChatApiConfigured()) return null;
  try {
    const uid = await requireUid();
    const db = getFirestoreDb();
    const q = query(
      collection(db, 'chatConversations'),
      where('memberIds', 'array-contains', uid),
    );
    const snap = await getDocs(q);
    const conversations: ChatBackupConversation[] = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as ConversationDoc;
      const memberIds = data.memberIds || [];
      if (!memberIds.includes(uid)) continue;

      const msgSnap = await getDocs(
        query(
          collection(db, 'chatConversations', docSnap.id, 'messages'),
          orderBy('createdAt', 'asc'),
          limit(MAX_BACKUP_MESSAGES_PER_CONV),
        ),
      );
      const messages: ChatBackupMessage[] = msgSnap.docs.map((m) => {
        const row = m.data() as {
          senderId: string;
          body: string;
          createdAt?: Timestamp;
        };
        return {
          id: m.id,
          senderId: row.senderId,
          body: row.body,
          createdAt: tsToIso(row.createdAt) || new Date().toISOString(),
        };
      });

      conversations.push({
        id: docSnap.id,
        type: data.type === 'group' ? 'group' : 'dm',
        title: data.title,
        createdBy: data.createdBy,
        memberIds,
        members: data.members || {},
        lastMessage: data.lastMessage ?? null,
        lastMessageAt: tsToIso(data.lastMessageAt),
        unread: data.unread || {},
        messages,
      });
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      firebaseUid: uid,
      conversations,
    };
  } catch {
    // Chat backup is best-effort — study sync should still succeed.
    return null;
  }
}

/**
 * Restore conversations/messages from a Drive chat backup into Firestore.
 * Merges missing threads/messages; does not delete live chat data.
 */
export async function restoreChatBackup(
  backup: ChatBackupPayload | null | undefined,
  sessionUser: { id: string; email: string; name: string },
): Promise<ChatBackupRestoreResult> {
  const empty = { conversations: 0, messages: 0 };
  if (!backup || backup.version !== 1 || !Array.isArray(backup.conversations)) {
    return empty;
  }
  if (!isChatApiConfigured()) return empty;

  try {
    await ensureChatSession(sessionUser);
    const uid = await requireUid();
    const fromUid = backup.firebaseUid || uid;
    const db = getFirestoreDb();

    let restoredConversations = 0;
    let restoredMessages = 0;

    for (const raw of backup.conversations) {
      if (!raw || !Array.isArray(raw.memberIds) || raw.memberIds.length < 2) {
        continue;
      }

      const isGroup = raw.type === 'group';
      const conversationId = isGroup
        ? raw.id
        : remapDmConversationId(raw.id, fromUid, uid);

      const memberIds = Array.from(
        new Set(raw.memberIds.map((id) => remapUid(id, fromUid, uid))),
      ).sort();
      if (!memberIds.includes(uid)) continue;

      const members: Record<string, { email: string; name: string }> = {};
      for (const [id, info] of Object.entries(raw.members || {})) {
        const mappedId = remapUid(id, fromUid, uid);
        members[mappedId] = {
          email: info?.email || 'unknown',
          name: info?.name || 'Student',
        };
      }

      const unread: Record<string, number> = {};
      for (const [id, count] of Object.entries(raw.unread || {})) {
        unread[remapUid(id, fromUid, uid)] = Number(count) || 0;
      }
      for (const id of memberIds) {
        if (unread[id] == null) unread[id] = 0;
      }

      const convRef = doc(db, 'chatConversations', conversationId);
      const existing = await getDoc(convRef);
      if (!existing.exists()) {
        const payload: ConversationDoc = {
          type: isGroup ? 'group' : 'dm',
          ...(isGroup
            ? {
                title:
                  (raw.title || 'Group chat').trim().slice(0, 80) ||
                  'Group chat',
                // Restoring user becomes createdBy so group create rules pass.
                createdBy: uid,
              }
            : {}),
          memberIds,
          members,
          lastMessage: raw.lastMessage ?? null,
          lastMessageAt: isoToTimestamp(raw.lastMessageAt),
          unread,
        };
        try {
          await setDoc(convRef, payload);
          restoredConversations += 1;
        } catch {
          // Skip conversations we cannot recreate (rules / race).
          continue;
        }
      } else {
        const live = existing.data() as ConversationDoc;
        if (!(live.memberIds || []).includes(uid)) continue;
        restoredConversations += 1;
      }

      for (const msg of raw.messages || []) {
        if (!msg?.id || !msg.body?.trim()) continue;
        const senderId = remapUid(msg.senderId, fromUid, uid);
        if (!memberIds.includes(senderId)) continue;

        const messageRef = doc(
          db,
          'chatConversations',
          conversationId,
          'messages',
          msg.id,
        );
        try {
          const msgSnap = await getDoc(messageRef);
          if (msgSnap.exists()) continue;
          const createdAt =
            isoToTimestamp(msg.createdAt) || Timestamp.now();
          await setDoc(messageRef, {
            senderId,
            body: String(msg.body).slice(0, 4000),
            createdAt,
            restored: true,
          });
          restoredMessages += 1;
        } catch {
          // skip individual message failures
        }
      }
    }

    return {
      conversations: restoredConversations,
      messages: restoredMessages,
    };
  } catch {
    return empty;
  }
}
