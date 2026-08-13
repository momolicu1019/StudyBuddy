import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
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
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  ensureChatSession,
  markConversationRead,
  registerChatPushForCurrentUser,
  sendMessage,
  subscribeMessages,
  updateGroupTitle,
  type ChatMessage,
} from '../api/chatApi';
import { AppModal, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

export function ChatThreadScreen({ navigation, route }: Props) {
  const { conversationId, peerName, isGroup } = route.params;
  const { session } = useAuth();
  const { showToast } = useApp();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const lastCountRef = useRef(0);
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;

  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(peerName);
  const [renaming, setRenaming] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: peerName || (isGroup ? 'Group chat' : 'Chat'),
      headerRight: isGroup
        ? () => (
            <Pressable
              onPress={() => {
                setRenameDraft(peerName);
                setRenameOpen(true);
              }}
              hitSlop={10}
              accessibilityLabel="Rename group"
              style={styles.headerBtn}
            >
              <Ionicons name="create-outline" size={22} color={colors.primary} />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, peerName, isGroup]);

  // Auth + live message listener — updates as soon as the peer sends.
  useEffect(() => {
    if (!session?.user) return;

    let unsub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const me = await ensureChatSession({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        });
        if (cancelled) return;
        setMyId(me.id);
        unsub = subscribeMessages(
          conversationId,
          (rows) => {
            if (cancelled) return;
            setMessages(rows);
            setLoading(false);
            if (rows.length > lastCountRef.current) {
              requestAnimationFrame(() => {
                listRef.current?.scrollToEnd({ animated: true });
              });
            }
            lastCountRef.current = rows.length;
            if (focusedRef.current) {
              void markConversationRead(conversationId);
            }
          },
          (err) => {
            if (cancelled) return;
            setLoading(false);
            showToast(err.message || 'Could not sync chat');
          },
        );
      } catch (e) {
        if (cancelled) return;
        setLoading(false);
        showToast(e instanceof Error ? e.message : 'Could not load chat');
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [
    conversationId,
    session?.user?.id,
    session?.user?.email,
    session?.user?.name,
    showToast,
  ]);

  useEffect(() => {
    if (isFocused) {
      void markConversationRead(conversationId);
    }
  }, [conversationId, isFocused]);

  // Keep composer above the software keyboard on iOS and Android.
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Refresh push token while chatting so recipients stay reachable.
  useEffect(() => {
    if (!session?.user) return;
    void registerChatPushForCurrentUser();
  }, [session?.user?.id]);

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

  const onRename = async () => {
    const next = renameDraft.trim();
    if (!next) {
      showToast('Enter a group name');
      return;
    }
    if (next === peerName) {
      setRenameOpen(false);
      return;
    }
    setRenaming(true);
    try {
      const conv = await updateGroupTitle(conversationId, next);
      navigation.setParams({
        peerName: conv.title,
        peerEmail: conv.peer.email,
        isGroup: true,
      });
      setRenameOpen(false);
      showToast('Group name updated');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not rename group');
    } finally {
      setRenaming(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Stack screen has no tab bar. Lift a bit past the raw keyboard height so the
  // composer + Send button clear gesture bars / nav gaps.
  const KEYBOARD_EXTRA_GAP = 28;
  const iosOffset = headerHeight + KEYBOARD_EXTRA_GAP;
  const androidLift =
    keyboardHeight > 0 ? keyboardHeight + KEYBOARD_EXTRA_GAP : 0;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={iosOffset}
      enabled={Platform.OS === 'ios'}
    >
      <View
        style={[
          styles.screen,
          Platform.OS === 'android' && androidLift > 0
            ? { paddingBottom: androidLift }
            : null,
        ]}
      >
        <FlatList
          ref={listRef}
          style={styles.listFlex}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: false })
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {isGroup
                ? `Say hi to ${peerName}. Group messages sync when members are online.`
                : `Say hi to ${peerName}. Messages sync when both of you are online.`}
            </Text>
          }
          renderItem={({ item }) => {
            const mine = myId != null && item.sender_id === myId;
            return (
              <View
                style={[styles.bubble, mine ? styles.mine : styles.theirs]}
              >
                {isGroup && !mine && item.sender_name ? (
                  <Text style={styles.senderName}>{item.sender_name}</Text>
                ) : null}
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
            {
              paddingBottom: keyboardVisible
                ? KEYBOARD_EXTRA_GAP
                : Math.max(insets.bottom, 10),
            },
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
            onFocus={() => {
              requestAnimationFrame(() => {
                listRef.current?.scrollToEnd({ animated: true });
              });
            }}
          />
          <Pressable
            onPress={() => void onSend()}
            style={[
              styles.send,
              (!input.trim() || sending) && styles.sendDisabled,
            ]}
            disabled={!input.trim() || sending}
          >
            <Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>

      <AppModal visible={renameOpen} onClose={() => setRenameOpen(false)}>
        <Text style={styles.modalTitle}>Rename group</Text>
        <Text style={styles.modalHint}>
          Any member can update the community name. Everyone sees the new name
          right away.
        </Text>
        <TextInput
          value={renameDraft}
          onChangeText={setRenameDraft}
          placeholder="Group name"
          placeholderTextColor={colors.muted}
          style={styles.renameInput}
          maxLength={80}
          autoFocus
        />
        <PrimaryButton
          label={renaming ? 'Saving…' : 'Save name'}
          onPress={() => void onRename()}
        />
      </AppModal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  listFlex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  headerBtn: {
    marginRight: 4,
    padding: 4,
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
  senderName: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
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
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 8,
  },
  modalHint: { color: colors.muted, marginBottom: 12, lineHeight: 20 },
  renameInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: '#fff',
  },
});
