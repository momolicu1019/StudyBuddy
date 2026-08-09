import { Platform } from 'react-native';

import type {
  Flashcard,
  GenerateResponse,
  QuizQuestion,
  QuizResult,
  Stats,
  Subject,
  TutorReply,
} from './types';

// Android emulator reaches host via 10.0.2.2; iOS simulator uses localhost.
const HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? `http://${HOST}:8000`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  getSubjects: (q?: string) =>
    request<Subject[]>(`/api/subjects${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createSubject: (name: string, icon: string) =>
    request<Subject>('/api/subjects', {
      method: 'POST',
      body: JSON.stringify({ name, icon }),
    }),
  updateSubject: (id: number, name: string, icon: string) =>
    request<Subject>(`/api/subjects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, icon }),
    }),
  deleteSubject: (id: number) =>
    request<{ status: string }>(`/api/subjects/${id}`, { method: 'DELETE' }),
  getFlashcards: (subjectId: number) =>
    request<Flashcard[]>(`/api/flashcards/${subjectId}`),
  generateFlashcards: (subjectId: number, sourceType: 'pdf' | 'photo', filename: string) =>
    request<GenerateResponse>('/api/flashcards/generate', {
      method: 'POST',
      body: JSON.stringify({
        subject_id: subjectId,
        source_type: sourceType,
        filename,
      }),
    }),
  getQuiz: (subjectId: number) => request<QuizQuestion[]>(`/api/quiz/${subjectId}`),
  submitQuiz: (subjectId: number, answers: Record<number, number>) =>
    request<QuizResult>('/api/quiz/submit', {
      method: 'POST',
      body: JSON.stringify({ subject_id: subjectId, answers }),
    }),
  askTutor: (message: string, subject?: string) =>
    request<TutorReply>('/api/tutor/ask', {
      method: 'POST',
      body: JSON.stringify({ message, subject }),
    }),
  getStats: () => request<Stats>('/api/stats'),
  logFocus: (minutes: number) =>
    request<Stats>('/api/stats/focus', {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    }),
};
