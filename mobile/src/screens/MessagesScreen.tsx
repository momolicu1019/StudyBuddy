import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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
  isChatApiConfigured,
  openDm,
  subscribeConversations,
  type ChatConversation,
} from '../api/chatApi';
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
  });
}

export function MessagesScreen({ navigation }: Props) {
  const { session, isSignedIn, skippedLogin } = useAuth();
  const { showToast } = useApp();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>('dm');
  const [peerEmail, setPeerEmail] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupEmails, setGroupEmails] = useState<string[]>([]);
  const [groupEmailDraft, setGroupEmailDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const canChat = isSignedIn && !skippedLogin && Boolean(session?.user);

  // Ensure chat auth, then keep the inbox in sync with Firestore.
  useEffect(() => {
    if (!canChat || !session?.user) {
      setLoading(false);
      setRefreshing(false);
      setConversations([]);
      setError('Sign in with Google or email to message other students.');
      return;
    }
    if (!isChatApiConfigured()) {
      setLoading(false);
      setRefreshing(false);
      setConversations([]);
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
        unsub = subscribeConversations(
          (rows) => {
            if (cancelled) return;
            setConversations(rows);
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

  const startChat = async () => {
    const email = peerEmail.trim().toLowerCase();
    if (!email) {
      showToast('Enter a classmate’s email');
      return;
    }
    setStarting(true);
    try {
      const conv = await openDm(email);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error && conversations.length === 0) {
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
            onPress={() => openCompose('dm')}
            style={styles.actionBtn}
          />
          <PrimaryButton
            label="New group"
            variant="secondary"
            onPress={() => openCompose('group')}
            style={styles.actionBtn}
          />
        </View>
      </View>

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
                <Text style={styles.preview} numberOfLines={1}>
                  {item.last_message ||
                    (isGroup
                      ? `${item.members.length} members`
                      : item.peer.email)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
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
});
