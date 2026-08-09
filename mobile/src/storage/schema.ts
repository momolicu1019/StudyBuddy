import type { DraftFlashcard, Flashcard, Stats, Subject } from '../api/types';

/** On-device database — primary Study Buddy storage (local-first). */
export type LocalDatabase = {
  subjects: Subject[];
  flashcards: Record<string, Flashcard[]>;
  /** Copied note files (PDF / photo) kept on device. */
  pdfs: StoredSource[];
  progress: Stats & { quizzes_taken: number };
  quizzes: QuizResultRecord[];
  settings: AppSettings;
  next_subject_id: number;
  next_card_id: number;
  next_pdf_id: number;
};

export type StoredSource = {
  id: number;
  name: string;
  source_type: 'pdf' | 'photo';
  /** Absolute/local URI under the app documents directory. */
  uri: string;
  original_uri?: string;
  created_at: string;
  subject_id?: number;
};

export type QuizResultRecord = {
  id: number;
  subject_id: number;
  score: number;
  total: number;
  percentage: number;
  created_at: string;
};

export type AppSettings = {
  cloud_sync_enabled: boolean;
  daily_goal_minutes: number;
};

export const EMPTY_LOCAL_DB: LocalDatabase = {
  subjects: [],
  flashcards: {},
  pdfs: [],
  progress: {
    flashcards_reviewed: 0,
    quiz_average: 0,
    focus_hours: 0,
    quizzes_taken: 0,
  },
  quizzes: [],
  settings: {
    cloud_sync_enabled: false,
    daily_goal_minutes: 25,
  },
  next_subject_id: 1,
  next_card_id: 1,
  next_pdf_id: 1,
};

export type { DraftFlashcard };
