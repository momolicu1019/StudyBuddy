import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import {
  createGroupChat,
  ensureChatSession,
  hideConversation,
  isChatApiConfigured,
  leaveGroup,
  openDm,
  registerChatPushForCurrentUser,
  subscribeConversations,
  type ChatConversation,
  type ChatFriend,
} from '../api/chatApi';
import {
  diagnoseChatPush,
  sendSelfTestChatPush,
  type ChatPushDiagnosis,
} from '../api/chatNotifications';
import { AppModal, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Messages'>;
type ComposeMode = 'dm' | 'group';

function openThread(
  navigation: Props['navigation'],
  conv: ChatConversation,
) {
  navigation.navigate('ChatThread', {
    conversationId: conv.id,
    peerName: conv.title,
    peerEmail: conv.peer.email,
    isGroup: conv.type === 'group',
    memberCount: conv.type === 'group' ? conv.members.length : undefined,
  });
}

export function MessagesScreen({ navigation }: Props) {
  const { session, isSignedIn, skippedLogin } = useAuth();
  const { showToast } = useApp();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [friends, setFriends] = useState<ChatFriend[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>('dm');
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [peerEmail, setPeerEmail] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupEmails, setGroupEmails] = useState<string[]>([]);
  const [groupEmailDraft, setGroupEmailDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<ChatConversation | null>(
    null,
  );
  const [pendingLeave, setPendingLeave] = useState<ChatConversation | null>(
    null,
  );
  const [busyAction, setBusyAction] = useState(false);
  const [pushInfo, setPushInfo] = useState<ChatPushDiagnosis | null>(null);
  const [pushTesting, setPushTesting] = useState(false);

  const canChat = isSignedIn && !skippedLogin && Boolean(session?.user);

  // Ensure chat auth, then keep the inbox in sync with Firestore.
  useEffect(() => {
    if (!canChat || !session?.user) {
      setLoading(false);
      setRefreshing(false);
      setConversations([]);
      setFriends([]);
      setError('Sign in with Google or email to message other students.');
      return;
    }
    if (!isChatApiConfigured()) {
      setLoading(false);
      setRefreshing(false);
      setConversations([]);
      setFriends([]);
      setError(
        'Firebase chat is not configured. Add EXPO_PUBLIC_FIREBASE_* to mobile/.env (see FIREBASE_CHAT.md).',
      );
      return;
    }

    let unsub: (() => void) | undefined;
    let cancelled = false;
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        await ensureChatSession({
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        });
        if (cancelled) return;
        void registerChatPushForCurrentUser();
        unsub = subscribeConversations(
          (rows, friendRows) => {
            if (cancelled) return;
            setConversations(rows);
            setFriends(friendRows);
            setError(null);
            setLoading(false);
            setRefreshing(false);
          },
          (err) => {
            if (cancelled) return;
            setError(err.message);
            setLoading(false);
            setRefreshing(false);
          },
        );
        void diagnoseChatPush().then((info) => {
          if (!cancelled) setPushInfo(info);
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load messages');
        setLoading(false);
        setRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [
    canChat,
    session?.user?.id,
    session?.user?.email,
    session?.user?.name,
    retryToken,
  ]);

  const onRefresh = () => {
    setRefreshing(true);
    setRetryToken((n) => n + 1);
  };

  const resetCompose = () => {
    setPeerEmail('');
    setGroupTitle('');
    setGroupEmails([]);
    setGroupEmailDraft('');
    setComposeMode('dm');
  };

  const closeCompose = () => {
    setComposeOpen(false);
    resetCompose();
  };

  const openCompose = (mode: ComposeMode) => {
    resetCompose();
    setComposeMode(mode);
    setComposeOpen(true);
  };

  const addGroupEmail = () => {
    const email = groupEmailDraft.trim().toLowerCase();
    if (!email) {
      showToast('Enter a friend’s email');
      return;
    }
    if (groupEmails.includes(email)) {
      showToast('That email is already on the list');
      return;
    }
    if (session?.user?.email && email === session.user.email.toLowerCase()) {
      showToast('You are already in the group');
      return;
    }
    setGroupEmails((prev) => [...prev, email]);
    setGroupEmailDraft('');
  };

  const removeGroupEmail = (email: string) => {
    setGroupEmails((prev) => prev.filter((e) => e !== email));
  };

  const startChat = async (emailRaw?: string) => {
    const email = (emailRaw ?? peerEmail).trim().toLowerCase();
    if (!email) {
      showToast('Enter a classmate’s email');
      return;
    }
    setStarting(true);
    try {
      const conv = await openDm(email);
      setFriendsOpen(false);
      closeCompose();
      openThread(navigation, conv);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start chat');
    } finally {
      setStarting(false);
    }
  };

  const startGroup = async () => {
    if (!groupTitle.trim()) {
      showToast('Enter a group name');
      return;
    }
    if (groupEmails.length < 1) {
      showToast('Add at least one friend’s email');
      return;
    }
    setStarting(true);
    try {
      const conv = await createGroupChat({
        title: groupTitle,
        memberEmails: groupEmails,
      });
      closeCompose();
      openThread(navigation, conv);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not create group');
    } finally {
      setStarting(false);
    }
  };

  const confirmDeleteChat = async () => {
    if (!pendingDelete || busyAction) return;
    setBusyAction(true);
    try {
      await hideConversation(pendingDelete.id);
      setPendingDelete(null);
      showToast('Chat deleted');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete chat');
    } finally {
      setBusyAction(false);
    }
  };

  const confirmLeaveGroup = async () => {
    if (!pendingLeave || busyAction) return;
    setBusyAction(true);
    try {
      await leaveGroup(pendingLeave.id);
      setPendingLeave(null);
      showToast('Left group');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not leave group');
    } finally {
      setBusyAction(false);
    }
  };

  const runPushSelfTest = async () => {
    if (pushTesting) return;
    setPushTesting(true);
    setPushInfo((prev) => ({
      permission: prev?.permission ?? 'unknown',
      hasNativeToken: prev?.hasNativeToken ?? false,
      expoToken: prev?.expoToken ?? null,
      isExpoGo: prev?.isExpoGo ?? false,
      error:
        'Waiting on Google Play Services for an FCM token (up to ~20s)…',
    }));
    try {
      const info = await diagnoseChatPush();
      setPushInfo(info);
      if (info.error || !info.expoToken) {
        showToast(info.error || 'Push is not ready on this install.');
        return;
      }
      setPushInfo({
        ...info,
        error: 'Sending Expo→FCM test notification…',
      });
      const result = await sendSelfTestChatPush();
      const after = await diagnoseChatPush();
      setPushInfo(after);
      if (result.deliveryError) {
        showToast(result.deliveryError);
      } else if (result.accepted > 0) {
        showToast(
          'Push test sent. You should see a banner now. Then swipe the app away (don’t Force stop) and have a classmate message you.',
        );
      } else {
        showToast('Push test did not get an Expo ticket — check FCM on EAS.');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Push test failed';
      setPushInfo((prev) => ({
        permission: prev?.permission ?? 'unknown',
        hasNativeToken: prev?.hasNativeToken ?? false,
        expoToken: prev?.expoToken ?? null,
        isExpoGo: prev?.isExpoGo ?? false,
        error: message,
      }));
      showToast(message);
    } finally {
      setPushTesting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error && conversations.length === 0 && friends.length === 0) {
    return (
      <View style={styles.centerPad}>
        <Ionicons name="chatbubbles-outline" size={40} color={colors.muted} />
        <Text style={styles.errorTitle}>Messages</Text>
        <Text style={styles.errorBody}>{error}</Text>
        {canChat && isChatApiConfigured() ? (
          <PrimaryButton
            label="Try again"
            onPress={() => {
              setLoading(true);
              setRetryToken((n) => n + 1);
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <Text style={styles.hint}>
          Message classmates 1:1 or start a group community
        </Text>
        <View style={styles.toolbarActions}>
          <PrimaryButton
            label="New chat"
            onPress={() => {
              setFriendsOpen(false);
              openCompose('dm');
            }}
            style={styles.actionBtn}
          />
          <PrimaryButton
            label="New group"
            variant="secondary"
            onPress={() => {
              setFriendsOpen(false);
              openCompose('group');
            }}
            style={styles.actionBtn}
          />
          <Pressable
            onPress={() => setFriendsOpen((open) => !open)}
            style={({ pressed }) => [
              styles.friendsDropdownBtn,
              friendsOpen && styles.friendsDropdownBtnOpen,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ expanded: friendsOpen }}
            accessibilityLabel="Friends"
          >
            <Ionicons
              name="people-outline"
              size={16}
              color={colors.primary}
            />
            <Text style={styles.friendsDropdownBtnText}>Friends</Text>
            <Ionicons
              name={friendsOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </Pressable>
        </View>
        {friendsOpen ? (
          <View style={styles.friendsDropdown}>
            <Text style={styles.friendsDropdownHint}>
              Emails from your past chats — tap to start a new message
            </Text>
            {friends.length === 0 ? (
              <Text style={styles.friendsDropdownEmpty}>
                No friends yet. Start a chat to add classmates here.
              </Text>
            ) : (
              <ScrollView
                style={styles.friendsDropdownList}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {friends.map((friend) => (
                  <Pressable
                    key={friend.email}
                    style={({ pressed }) => [
                      styles.friendRow,
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => void startChat(friend.email)}
                    disabled={starting}
                  >
                    <View style={styles.friendRowAvatar}>
                      <Ionicons
                        name="person-outline"
                        size={16}
                        color={colors.primary}
                      />
                    </View>
                    <Text style={styles.friendRowText} numberOfLines={1}>
                      {friend.email}
                    </Text>
                    <Ionicons
                      name="chatbubble-outline"
                      size={16}
                      color={colors.muted}
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>

      {canChat ? (
        <View style={styles.pushPanel}>
          <Text style={styles.pushTitle}>Closed-app push check</Text>
          <Text style={styles.pushBody}>
            {pushInfo?.isExpoGo
              ? 'Expo Go cannot receive killed-app chat alerts. Install StudyBuddy APK v1.0.2+.'
              : pushInfo?.error
                ? pushInfo.error
                : pushInfo?.expoToken
                  ? `Ready · token …${pushInfo.expoToken.slice(-12)}`
                  : 'Checking push registration…'}
          </Text>
          <PrimaryButton
            label={pushTesting ? 'Testing…' : 'Test push on this phone'}
            variant="secondary"
            onPress={() => void runPushSelfTest()}
            style={styles.pushTestBtn}
          />
        </View>
      ) : null}

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={
          conversations.length === 0 ? styles.emptyList : styles.list
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptyBody}>
              Tap New chat for a 1:1 DM, or New group to create a community with
              friends.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isGroup = item.type === 'group';
          const initials = item.title
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? '')
            .join('') || (isGroup ? 'G' : '?');
          return (
            <Pressable
              style={styles.row}
              onPress={() => openThread(navigation, item)}
              onLongPress={() => setPendingDelete(item)}
              delayLongPress={350}
            >
              <View
                style={[styles.avatar, isGroup && styles.avatarGroup]}
              >
                {isGroup ? (
                  <Ionicons name="people" size={20} color={colors.primary} />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.peerName} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.unread_count > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unread_count}</Text>
                    </View>
                  ) : null}
                </View>
                {isGroup ? (
                  <Text style={styles.memberCount} numberOfLines={1}>
                    {item.members.length}{' '}
                    {item.members.length === 1 ? 'member' : 'members'}
                  </Text>
                ) : null}
                <Text style={styles.preview} numberOfLines={1}>
                  {item.last_message ||
                    (isGroup ? 'No messages yet' : item.peer.email)}
                </Text>
              </View>
              {isGroup ? (
                <Pressable
                  onPress={() => setPendingLeave(item)}
                  hitSlop={8}
                  accessibilityLabel="Leave group"
                  style={styles.leaveBtn}
                >
                  <Ionicons
                    name="exit-outline"
                    size={20}
                    color={colors.danger}
                  />
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              )}
            </Pressable>
          );
        }}
      />

      <AppModal visible={composeOpen} onClose={closeCompose}>
        <View style={styles.modeTabs}>
          <Pressable
            onPress={() => setComposeMode('dm')}
            style={[
              styles.modeTab,
              composeMode === 'dm' && styles.modeTabActive,
            ]}
          >
            <Text
              style={[
                styles.modeTabText,
                composeMode === 'dm' && styles.modeTabTextActive,
              ]}
            >
              Direct
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setComposeMode('group')}
            style={[
              styles.modeTab,
              composeMode === 'group' && styles.modeTabActive,
            ]}
          >
            <Text
              style={[
                styles.modeTabText,
                composeMode === 'group' && styles.modeTabTextActive,
              ]}
            >
              Group
            </Text>
          </Pressable>
        </View>

        {composeMode === 'dm' ? (
          <>
            <Text style={styles.modalTitle}>New message</Text>
            <Text style={styles.modalHint}>
              Enter the email your classmate uses to sign in to Study Buddy.
            </Text>
            <TextInput
              value={peerEmail}
              onChangeText={setPeerEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="classmate@school.edu"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <PrimaryButton
              label={starting ? 'Starting…' : 'Start chat'}
              onPress={() => void startChat()}
            />
          </>
        ) : (
          <>
            <Text style={styles.modalTitle}>New group community</Text>
            <Text style={styles.modalHint}>
              Name your group and add friends by their Study Buddy email. They
              must open Messages once first.
            </Text>
            <TextInput
              value={groupTitle}
              onChangeText={setGroupTitle}
              placeholder="Group name (e.g. Bio study crew)"
              placeholderTextColor={colors.muted}
              style={styles.input}
              maxLength={80}
            />
            <View style={styles.addRow}>
              <TextInput
                value={groupEmailDraft}
                onChangeText={setGroupEmailDraft}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="friend@school.edu"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.addInput]}
                onSubmitEditing={addGroupEmail}
                returnKeyType="done"
              />
              <PrimaryButton
                label="Add"
                variant="secondary"
                onPress={addGroupEmail}
                style={styles.addBtn}
              />
            </View>
            {groupEmails.length > 0 ? (
              <View style={styles.chipWrap}>
                {groupEmails.map((email) => (
                  <Pressable
                    key={email}
                    onPress={() => removeGroupEmail(email)}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{email}</Text>
                    <Ionicons name="close" size={14} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.memberHint}>
                Add at least one friend to create the group.
              </Text>
            )}
            <PrimaryButton
              label={starting ? 'Creating…' : 'Create group'}
              onPress={() => void startGroup()}
            />
          </>
        )}
      </AppModal>

      <AppModal
        visible={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
      >
        <View style={styles.confirmWrap}>
          <View style={styles.confirmIcon}>
            <Ionicons name="trash-outline" size={28} color={colors.danger} />
          </View>
          <Text style={[styles.modalTitle, styles.confirmTitle]}>Delete this chat?</Text>
          <Text style={styles.confirmBody}>
            Remove
            {pendingDelete ? ` “${pendingDelete.title}”` : ' this chat'} from
            your inbox? You can start it again from Friends or New chat.
          </Text>
          <View style={styles.modalActions}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={() => setPendingDelete(null)}
              style={styles.modalActionBtn}
            />
            <PrimaryButton
              label={busyAction ? 'Deleting…' : 'Delete'}
              variant="danger"
              onPress={() => void confirmDeleteChat()}
              style={styles.modalActionBtn}
            />
          </View>
        </View>
      </AppModal>

      <AppModal
        visible={pendingLeave !== null}
        onClose={() => setPendingLeave(null)}
      >
        <View style={styles.confirmWrap}>
          <View style={styles.confirmIcon}>
            <Ionicons name="exit-outline" size={28} color={colors.danger} />
          </View>
          <Text style={[styles.modalTitle, styles.confirmTitle]}>Leave this group?</Text>
          <Text style={styles.confirmBody}>
            Leave
            {pendingLeave ? ` “${pendingLeave.title}”` : ' this group'}? It will
            be removed from your chat box. Someone must invite you again to
            rejoin.
          </Text>
          <View style={styles.modalActions}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={() => setPendingLeave(null)}
              style={styles.modalActionBtn}
            />
            <PrimaryButton
              label={busyAction ? 'Leaving…' : 'Leave group'}
              variant="danger"
              onPress={() => void confirmLeaveGroup()}
              style={styles.modalActionBtn}
            />
          </View>
        </View>
      </AppModal>
    </View>
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
  centerPad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
    backgroundColor: colors.bg,
  },
  errorTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  errorBody: { textAlign: 'center', color: colors.muted, lineHeight: 20 },
  toolbar: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  hint: { color: colors.muted, fontSize: 13 },
  toolbarActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  actionBtn: { alignSelf: 'flex-start' },
  pushPanel: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    gap: 8,
  },
  pushTitle: { fontSize: 13, fontWeight: '800', color: colors.ink },
  pushBody: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  pushTestBtn: { alignSelf: 'flex-start' },
  friendsDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  friendsDropdownBtnOpen: {
    borderColor: colors.primary,
  },
  friendsDropdownBtnText: {
    color: colors.primary,
    fontWeight: '750' as unknown as '700',
    fontSize: 15,
  },
  friendsDropdown: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  friendsDropdownHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  friendsDropdownEmpty: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  friendsDropdownList: {
    maxHeight: 200,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: '#fff',
  },
  friendRowAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendRowText: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  list: { paddingVertical: 8 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  emptyBody: { textAlign: 'center', color: colors.muted, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGroup: {
    borderRadius: 14,
  },
  avatarText: { color: colors.primary, fontWeight: '800' },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  peerName: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink },
  memberCount: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  preview: { color: colors.muted, fontSize: 13 },
  leaveBtn: {
    padding: 6,
  },
  modeTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  modeTabActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  modeTabText: { color: colors.muted, fontWeight: '700' },
  modeTabTextActive: { color: colors.primary },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 8,
  },
  confirmTitle: {
    textAlign: 'center',
  },
  modalHint: { color: colors.muted, marginBottom: 12, lineHeight: 20 },
  input: {
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
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
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
