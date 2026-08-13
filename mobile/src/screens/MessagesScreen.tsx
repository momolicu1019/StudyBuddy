import React, { useCallback, useEffect, useState } from 'react';
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
  ensureChatSession,
  isChatApiConfigured,
  listConversations,
  openDm,
  type ChatConversation,
} from '../api/chatApi';
import { AppModal, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Messages'>;

export function MessagesScreen({ navigation }: Props) {
  const { session, isSignedIn, skippedLogin } = useAuth();
  const { showToast } = useApp();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [peerEmail, setPeerEmail] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canChat = isSignedIn && !skippedLogin && Boolean(session?.user);

  const bootstrap = useCallback(async () => {
    if (!canChat || !session?.user) {
      setLoading(false);
      setError('Sign in with Google or email to message other students.');
      return;
    }
    if (!isChatApiConfigured()) {
      setLoading(false);
      setError(
        'Firebase chat is not configured. Add EXPO_PUBLIC_FIREBASE_* to mobile/.env (see FIREBASE_CHAT.md).',
      );
      return;
    }

    setError(null);
    try {
      await ensureChatSession({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      });
      const rows = await listConversations();
      setConversations(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load messages');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canChat, session]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const onRefresh = () => {
    setRefreshing(true);
    void bootstrap();
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
      setComposeOpen(false);
      setPeerEmail('');
      navigation.navigate('ChatThread', {
        conversationId: conv.id,
        peerName: conv.peer.name,
        peerEmail: conv.peer.email,
      });
      void bootstrap();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start chat');
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
          <PrimaryButton label="Try again" onPress={() => void bootstrap()} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <Text style={styles.hint}>Message classmates by email (1:1)</Text>
        <PrimaryButton
          label="New chat"
          onPress={() => setComposeOpen(true)}
          style={styles.newBtn}
        />
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
              Tap New chat and enter a classmate’s Study Buddy email.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              navigation.navigate('ChatThread', {
                conversationId: item.id,
                peerName: item.peer.name,
                peerEmail: item.peer.email,
              })
            }
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.peer.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase() ?? '')
                  .join('') || '?'}
              </Text>
            </View>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={styles.peerName} numberOfLines={1}>
                  {item.peer.name}
                </Text>
                {item.unread_count > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unread_count}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.preview} numberOfLines={1}>
                {item.last_message || item.peer.email}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
      />

      <AppModal
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
      >
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
  newBtn: { alignSelf: 'flex-start' },
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
});
