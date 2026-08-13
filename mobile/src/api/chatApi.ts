/**
 * Student 1:1 chat REST client.
 * Study data stays on localBackend; chat uses the cloud API + Neon.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'studybuddy.chat.token.v1';

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

function chatApiBaseUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_CHAT_API_URL || '').trim();
  if (!raw) return '';
  return raw.replace(/\/$/, '');
}

export function isChatApiConfigured(): boolean {
  return Boolean(chatApiBaseUrl());
}

async function loadToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function saveToken(token: string | null): Promise<void> {
  if (!token) {
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearChatSession(): Promise<void> {
  await saveToken(null);
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const base = chatApiBaseUrl();
  if (!base) {
    throw new Error(
      'Chat API URL is not configured. Set EXPO_PUBLIC_CHAT_API_URL in mobile/.env',
    );
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string>) || {}),
  };

  if (init.auth !== false) {
    const token = await loadToken();
    if (!token) throw new Error('Not signed in to chat');
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    let detail = `Chat request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string | { msg?: string }[] };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) {
        detail = body.detail[0].msg;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function upsertChatUser(input: {
  email: string;
  name: string;
  localAuthId: string;
}): Promise<ChatUser> {
  const data = await request<{ token: string; user: ChatUser }>(
    '/api/chat/auth/upsert',
    {
      method: 'POST',
      auth: false,
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        local_auth_id: input.localAuthId,
      }),
    },
  );
  await saveToken(data.token);
  return data.user;
}

export async function ensureChatSession(user: {
  email: string;
  name: string;
  id: string;
}): Promise<ChatUser> {
  const existing = await loadToken();
  if (existing) {
    try {
      return await getMe();
    } catch {
      await clearChatSession();
    }
  }
  return upsertChatUser({
    email: user.email,
    name: user.name,
    localAuthId: user.id,
  });
}

export async function getMe(): Promise<ChatUser> {
  return request<ChatUser>('/api/chat/me');
}

export async function listConversations(): Promise<ChatConversation[]> {
  return request<ChatConversation[]>('/api/chat/conversations');
}

export async function openDm(peerEmail: string): Promise<ChatConversation> {
  return request<ChatConversation>('/api/chat/dms', {
    method: 'POST',
    body: JSON.stringify({ peer_email: peerEmail.trim().toLowerCase() }),
  });
}

export async function listMessages(
  conversationId: string,
  opts?: { afterId?: string; limit?: number },
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (opts?.afterId) params.set('after_id', opts.afterId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const path = `/api/chat/conversations/${conversationId}/messages${
    qs ? `?${qs}` : ''
  }`;
  const data = await request<{ messages: ChatMessage[] }>(path);
  return data.messages;
}

export async function sendMessage(
  conversationId: string,
  body: string,
): Promise<ChatMessage> {
  return request<ChatMessage>(
    `/api/chat/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  );
}
