import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

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
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const cloudReady = isCloudTutorConfigured();
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      role: 'assistant',
      text: subject
        ? `Hi! I'm your AI Tutor for ${subject}. Ask me a real question and I'll answer it using your notes${cloudReady ? ' and AI' : ''}.`
        : `Hi! I'm your Study Buddy AI Tutor. Ask a content question (for example “What is photosynthesis?”) and I'll answer it${cloudReady ? '' : ' from your flashcards, or with AI once a key is configured'}.`,
    },
  ]);

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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <Text style={styles.h1}>✦ AI Tutor</Text>
        <Text style={styles.sub}>
          Ask questions and get direct answers
          {subject ? ` for ${subject}` : ''}.
          {!cloudReady
            ? ' Tip: add EXPO_PUBLIC_AI_API_KEY in mobile/.env for full AI answers on any topic.'
            : ''}
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

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask a study question..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
          editable={!busy}
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
  content: { padding: 16, paddingBottom: 20 },
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
    padding: 14,
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
