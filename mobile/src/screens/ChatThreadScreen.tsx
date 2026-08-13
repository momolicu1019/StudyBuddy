import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  addGroupMembers,
  ensureChatSession,
  getCachedChatUser,
  leaveGroup,
  markConversationRead,
  registerChatPushForCurrentUser,
  sendMessage,
  subscribeMessages,
  updateGroupTitle,
  type ChatMessage,
} from '../api/chatApi';
import { setActiveChatConversationId } from '../api/chatNotifications';
import { AppModal, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

function memberLabel(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`;
}

export function ChatThreadScreen({ navigation, route }: Props) {
  const { conversationId, peerName, peerEmail, isGroup, memberCount } =
    route.params;
  const { session } = useAuth();
  const { showToast } = useApp();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const lastCountRef = useRef(0);
  const lastMarkedReadRef = useRef(0);
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
  const [addOpen, setAddOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [inviteDraft, setInviteDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const displayMemberCount = useMemo(() => {
    if (!isGroup) return 0;
    if (typeof memberCount === 'number' && memberCount > 0) return memberCount;
    const fromEmail = Number(String(peerEmail || '').match(/^(\d+)/)?.[1] || 0);
    return fromEmail > 0 ? fromEmail : 0;
  }, [isGroup, memberCount, peerEmail]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: peerName || (isGroup ? 'Group chat' : 'Chat'),
      headerTitle: isGroup
        ? () => (
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {peerName || 'Group chat'}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {displayMemberCount > 0
                  ? memberLabel(displayMemberCount)
                  : 'Group chat'}
              </Text>
            </View>
          )
        : undefined,
      headerRight: isGroup
        ? () => (
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => {
                  setInviteEmails([]);
                  setInviteDraft('');
                  setAddOpen(true);
                }}
                hitSlop={10}
                accessibilityLabel="Add members"
                style={styles.headerBtn}
              >
                <Ionicons
                  name="person-add-outline"
                  size={22}
                  color={colors.primary}
                />
              </Pressable>
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
              <Pressable
                onPress={() => setLeaveOpen(true)}
                hitSlop={10}
                accessibilityLabel="Leave group"
                style={styles.headerBtn}
              >
                <Ionicons name="exit-outline" size={22} color={colors.danger} />
              </Pressable>
            </View>
          )
        : undefined,
    });
  }, [navigation, peerName, isGroup, displayMemberCount]);

  // Auth + live message listener — updates as soon as the peer sends.
  useEffect(() => {
    if (!session?.user) return;

    let unsub: (() => void) | undefined;
    let cancelled = false;

    const startMessages = (uid: string) => {
      if (cancelled) return;
      setMyId(uid);
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
            const now = Date.now();
            // Avoid a write storm: every own-send snapshot used to call markRead.
            if (now - lastMarkedReadRef.current > 2500) {
              lastMarkedReadRef.current = now;
              void markConversationRead(conversationId);
            }
          }
        },
        (err) => {
          if (cancelled) return;
          setLoading(false);
          showToast(err.message || 'Could not sync chat');
        },
      );
    };

    const cached = getCachedChatUser();
    if (cached) {
      // Inbox / header already warmed Firebase Auth — open the thread immediately.
      startMessages(cached.id);
      void ensureChatSession({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      }).catch(() => {
        // Non-fatal while the live listener is already running.
      });
      return () => {
        cancelled = true;
        unsub?.();
      };
    }

    void (async () => {
      try {
        const me = await ensureChatSession({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        });
        if (cancelled) return;
        startMessages(me.id);
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
      setActiveChatConversationId(conversationId);
      lastMarkedReadRef.current = Date.now();
      void markConversationRead(conversationId);
      // Cooldown inside registerChatPushForCurrentUser makes this cheap when
      // the token was already saved this minute.
      void registerChatPushForCurrentUser();
    } else {
      setActiveChatConversationId(null);
    }
    return () => {
      setActiveChatConversationId(null);
    };
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

  const onSend = async () => {
    const body = input.trim();
    if (!body || sending) return;
    const uid = myId || getCachedChatUser()?.id;
    if (!uid) {
      showToast('Chat is still connecting…');
      return;
    }

    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: uid,
      body,
      created_at: new Date().toISOString(),
    };

    // Show the bubble immediately — do not block the composer on Firestore.
    setInput('');
    setSending(true);
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
    setSending(false);

    try {
      const msg = await sendMessage(conversationId, body);
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        if (withoutTemp.some((m) => m.id === msg.id)) return withoutTemp;
        return [...withoutTemp, msg];
      });
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(body);
      showToast(e instanceof Error ? e.message : 'Could not send');
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
        memberCount: conv.members.length,
      });
      setRenameOpen(false);
      showToast('Group name updated');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not rename group');
    } finally {
      setRenaming(false);
    }
  };

  const addInviteEmail = () => {
    const email = inviteDraft.trim().toLowerCase();
    if (!email) {
      showToast('Enter a friend’s email');
      return;
    }
    if (inviteEmails.includes(email)) {
      showToast('That email is already on the list');
      return;
    }
    if (session?.user?.email && email === session.user.email.toLowerCase()) {
      showToast('You are already in the group');
      return;
    }
    setInviteEmails((prev) => [...prev, email]);
    setInviteDraft('');
  };

  const removeInviteEmail = (email: string) => {
    setInviteEmails((prev) => prev.filter((e) => e !== email));
  };

  const onAddMembers = async () => {
    if (inviteEmails.length < 1) {
      showToast('Add at least one friend’s email');
      return;
    }
    setAdding(true);
    try {
      const conv = await addGroupMembers(conversationId, inviteEmails);
      navigation.setParams({
        peerName: conv.title,
        peerEmail: conv.peer.email,
        isGroup: true,
        memberCount: conv.members.length,
      });
      setAddOpen(false);
      setInviteEmails([]);
      setInviteDraft('');
      showToast(
        conv.members.length === 1
          ? 'Member added'
          : `Group now has ${conv.members.length} members`,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not add members');
    } finally {
      setAdding(false);
    }
  };

  const onLeaveGroup = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await leaveGroup(conversationId);
      setLeaveOpen(false);
      showToast('Left group');
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('Messages');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not leave group');
    } finally {
      setLeaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Stack screen has no tab bar; lift by full keyboard height on Android.
  const iosOffset = headerHeight + 12;
  const androidLift = keyboardHeight > 0 ? keyboardHeight : 0;

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
                ? 10
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

      <AppModal
        visible={addOpen}
        onClose={() => {
          setAddOpen(false);
          setInviteEmails([]);
          setInviteDraft('');
        }}
      >
        <Text style={styles.modalTitle}>Add members</Text>
        <Text style={styles.modalHint}>
          Invite friends by Study Buddy email. They must open Messages once
          first.
          {displayMemberCount > 0
            ? ` This group currently has ${memberLabel(displayMemberCount)}.`
            : ''}
        </Text>
        <View style={styles.addRow}>
          <TextInput
            value={inviteDraft}
            onChangeText={setInviteDraft}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="friend@school.edu"
            placeholderTextColor={colors.muted}
            style={[styles.renameInput, styles.addInput]}
            onSubmitEditing={addInviteEmail}
            returnKeyType="done"
          />
          <PrimaryButton
            label="Add"
            variant="secondary"
            onPress={addInviteEmail}
            style={styles.addBtn}
          />
        </View>
        {inviteEmails.length > 0 ? (
          <View style={styles.chipWrap}>
            {inviteEmails.map((email) => (
              <Pressable
                key={email}
                onPress={() => removeInviteEmail(email)}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{email}</Text>
                <Ionicons name="close" size={14} color={colors.primary} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.memberHint}>
            Add one or more emails, then tap Invite.
          </Text>
        )}
        <PrimaryButton
          label={adding ? 'Inviting…' : 'Invite to group'}
          onPress={() => void onAddMembers()}
        />
      </AppModal>

      <AppModal visible={leaveOpen} onClose={() => setLeaveOpen(false)}>
        <View style={styles.confirmWrap}>
          <View style={styles.confirmIcon}>
            <Ionicons name="exit-outline" size={28} color={colors.danger} />
          </View>
          <Text style={[styles.modalTitle, styles.confirmTitle]}>
            Leave this group?
          </Text>
          <Text style={styles.confirmBody}>
            Leave “{peerName || 'this group'}”? It will be removed from your chat
            box. Someone must invite you again to rejoin.
          </Text>
          <View style={styles.modalActions}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={() => setLeaveOpen(false)}
              style={styles.modalActionBtn}
            />
            <PrimaryButton
              label={leaving ? 'Leaving…' : 'Leave group'}
              variant="danger"
              onPress={() => void onLeaveGroup()}
              style={styles.modalActionBtn}
            />
          </View>
        </View>
      </AppModal>
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
  headerTitleWrap: {
    alignItems: Platform.OS === 'ios' ? 'center' : 'flex-start',
    maxWidth: 220,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
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
  addRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  addInput: { flex: 1, marginBottom: 10 },
  addBtn: { marginTop: 0 },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  chipText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  memberHint: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 14,
  },
  confirmWrap: { alignItems: 'center' },
  confirmIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmTitle: { textAlign: 'center' },
  confirmBody: {
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  modalActionBtn: { flex: 1 },
});
