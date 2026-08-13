import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ensureChatSession,
  listMessages,
  sendMessage,
  subscribeMessages,
  type ChatMessage,
} from '../api/chatApi';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

export function ChatThreadScreen({ route }: Props) {
  const { conversationId, peerName } = route.params;
  const { session } = useAuth();
  const { showToast } = useApp();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadInitial = useCallback(async () => {
    if (!session?.user) return;
    try {
      const me = await ensureChatSession({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      });
      setMyId(me.id);
      // Seed once; live listener keeps the thread updated.
      const rows = await listMessages(conversationId, { limit: 100 });
      setMessages(rows);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not load chat');
    } finally {
      setLoading(false);
    }
  }, [conversationId, session, showToast]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Realtime Firestore subscription while this thread is open.
  useEffect(() => {
    if (!myId) return;
    const unsub = subscribeMessages(
      conversationId,
      (rows) => setMessages(rows),
      () => {
        // Ignore transient listener errors; pull-to-refresh path still works via remount.
      },
    );
    return () => unsub();
  }, [conversationId, myId]);

  const onSend = async () => {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setInput('');
    try {
      const msg = await sendMessage(conversationId, body);
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    } catch (e) {
      setInput(body);
      showToast(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Say hi to {peerName}. Messages sync when both of you are online.
          </Text>
        }
        renderItem={({ item }) => {
          const mine = myId != null && item.sender_id === myId;
          return (
            <View
              style={[styles.bubble, mine ? styles.mine : styles.theirs]}
            >
              <Text style={[styles.bubbleText, mine && styles.mineText]}>
                {item.body}
              </Text>
            </View>
          );
        }}
      />

      <View
        style={[
          styles.composer,
          { paddingBottom: Math.max(insets.bottom, 10) },
        ]}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={`Message ${peerName}`}
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
          maxLength={4000}
        />
        <Pressable
          onPress={() => void onSend()}
          style={[styles.send, (!input.trim() || sending) && styles.sendDisabled]}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  list: { padding: 16, paddingBottom: 8, flexGrow: 1 },
  empty: {
    textAlign: 'center',
    color: colors.muted,
    marginTop: 40,
    lineHeight: 20,
    paddingHorizontal: 24,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  mineText: { color: '#fff' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  send: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendDisabled: { opacity: 0.45 },
  sendText: { color: '#fff', fontWeight: '800' },
});
