import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { Card, PrimaryButton } from '../components/ui';
import { useApp } from '../context/AppContext';
import type { RootStackParamList } from '../navigation/types';
import { isCloudTutorConfigured } from '../storage/tutorEngine';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'AITutor'>;

type ChatItem = { role: 'user' | 'assistant'; text: string };

export function AITutorScreen({ route }: Props) {
  const subject = route.params?.subject;
  const { showToast } = useApp();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const cloudReady = isCloudTutorConfigured();
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      role: 'assistant',
      text: subject
        ? `Hi! I'm your AI Tutor for ${subject}. Ask me a real question and I'll answer it using your notes${cloudReady ? ' and AI' : ''}.`
        : `Hi! I'm your Study Buddy AI Tutor. Ask a content question (for example “What is photosynthesis?”) and I'll answer it${cloudReady ? '' : ' from your flashcards, or with AI once a key is configured'}.`,
    },
  ]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  async function send() {
    const text = input.trim();
    if (!text) {
      showToast('Type a question first');
      return;
    }
    if (busy) return;

    setInput('');
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await api.askTutor(text, subject, history);
      setMessages((prev) => [...prev, { role: 'assistant', text: res.reply }]);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text:
            'I could not answer that just now. Check your connection or AI key, then try asking again.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  // Stack header + tab bar (when opened from tabs) so the composer clears the keyboard.
  const keyboardOffset =
    headerHeight + (Platform.OS === 'ios' ? Math.max(tabBarHeight, 8) : 12);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior="padding"
      keyboardVerticalOffset={keyboardOffset}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <Text style={styles.h1}>✦ AI Tutor</Text>
        <Text style={styles.sub}>
          Ask questions and get direct answers
          {subject ? ` for ${subject}` : ''}.
          {!cloudReady
            ? ' Tip: restart Expo with `npx expo start -c` so your Gemini key from mobile/.env loads.'
            : ' Gemini is connected.'}
        </Text>

        <View style={styles.chat}>
          {messages.map((m, i) => (
            <Card
              key={`${m.role}-${i}`}
              style={[
                styles.bubble,
                m.role === 'user' ? styles.userBubble : styles.botBubble,
              ]}
            >
              <Text style={styles.bubbleText}>{m.text}</Text>
            </Card>
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            paddingBottom: Math.max(
              insets.bottom,
              keyboardVisible && Platform.OS === 'android' ? 10 : insets.bottom || 10,
            ),
          },
        ]}
      >
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask a study question..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
          editable={!busy}
          onFocus={() => {
            requestAnimationFrame(() => {
              scrollRef.current?.scrollToEnd({ animated: true });
            });
          }}
        />
        <PrimaryButton
          label={busy ? '…' : 'Send'}
          onPress={send}
          style={{ minWidth: 88, opacity: busy ? 0.7 : 1 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  chatScroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, flexGrow: 1 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, marginTop: 6, marginBottom: 18, lineHeight: 20 },
  chat: { gap: 12 },
  bubble: { padding: 16 },
  userBubble: {
    backgroundColor: colors.primarySoft,
    borderColor: '#D9D5FF',
    alignSelf: 'flex-end',
  },
  botBubble: { alignSelf: 'flex-start' },
  bubbleText: { color: colors.ink, lineHeight: 22, fontSize: 15 },
  composer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: '#fff',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
});
