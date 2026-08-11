import type { DraftFlashcard, Flashcard, Stats, Subject } from '../api/types';
import type { SourceKind } from './sourceMime';

/** On-device database — primary Study Buddy storage (local-first). */
export type LocalDatabase = {
  subjects: Subject[];
  flashcards: Record<string, Flashcard[]>;
  /** Copied note files kept on device. */
  pdfs: StoredSource[];
  progress: Stats & { quizzes_taken: number };
  quizzes: QuizResultRecord[];
  deadlines: Deadline[];
  settings: AppSettings;
  next_subject_id: number;
  next_card_id: number;
  next_pdf_id: number;
  next_deadline_id: number;
};

/** Student deadline / due-date entry. `due_date` is YYYY-MM-DD (local calendar day). */
export type Deadline = {
  id: number;
  title: string;
  due_date: string;
  completed: boolean;
  created_at: string;
};

export type StoredSource = {
  id: number;
  name: string;
  source_type: SourceKind;
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
  deadlines: [],
  settings: {
    cloud_sync_enabled: false,
    daily_goal_minutes: 25,
  },
  next_subject_id: 1,
  next_card_id: 1,
  next_pdf_id: 1,
  next_deadline_id: 1,
};

export type { DraftFlashcard };
