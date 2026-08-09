import React, { useState } from 'react';
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
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'AITutor'>;

type ChatItem = { role: 'user' | 'assistant'; text: string };

export function AITutorScreen({ route }: Props) {
  const subject = route.params?.subject;
  const { showToast } = useApp();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      role: 'assistant',
      text: subject
        ? `Hi! I'm your AI Tutor for ${subject}. Ask me anything and I'll explain it step by step.`
        : "Hi! I'm your Study Buddy AI Tutor. Ask a question about your notes, quizzes, or study plan.",
    },
  ]);

  async function send() {
    const text = input.trim();
    if (!text) {
      showToast('Type a question first');
      return;
    }
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await api.askTutor(text, subject);
      setMessages((prev) => [...prev, { role: 'assistant', text: res.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text:
            `Let's break that down${subject ? ` for ${subject}` : ''}.\n\n` +
            '1) Restate the question in your own words.\n' +
            '2) Identify the core idea.\n' +
            '3) Connect it to one example you know.\n' +
            '4) Teach it back in one sentence.\n\n' +
            'Want a worked example next?',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>✦ AI Tutor</Text>
        <Text style={styles.sub}>
          Ask questions and get step-by-step help
          {subject ? ` for ${subject}` : ''}.
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
          placeholder="Ask the AI Tutor..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />
        <PrimaryButton
          label={busy ? '…' : 'Send'}
          onPress={send}
          style={{ minWidth: 88 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 20 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, marginTop: 6, marginBottom: 18 },
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
