import AsyncStorage from '@react-native-async-storage/async-storage';

import { EMPTY_LOCAL_DB, type ActivityDay, type LocalDatabase, type TutorChat } from './schema';

const STORAGE_KEY = 'studybuddy.local.v1';

function normalizeActivityDays(
  raw: LocalDatabase['activity_days'] | null | undefined,
): Record<string, ActivityDay> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ActivityDay> = {};
  for (const [date, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !value || typeof value !== 'object') {
      continue;
    }
    out[date] = {
      focus_minutes: Number(value.focus_minutes) || 0,
      cards_reviewed: Number(value.cards_reviewed) || 0,
      quizzes_taken: Number(value.quizzes_taken) || 0,
    };
  }
  return out;
}

function normalizeTutorChat(raw: Partial<TutorChat>): TutorChat | null {
  if (typeof raw.id !== 'number') return null;
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .filter(
          (m): m is TutorChat['messages'][number] =>
            !!m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.text === 'string',
        )
        .map((m) => ({
          role: m.role,
          text: m.text,
          allow_flashcards: m.allow_flashcards,
          created_at:
            typeof m.created_at === 'string'
              ? m.created_at
              : new Date().toISOString(),
        }))
    : [];

  const created =
    typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString();
  return {
    id: raw.id,
    subject: typeof raw.subject === 'string' ? raw.subject : undefined,
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim()
        : 'Chat',
    messages,
    created_at: created,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : created,
  };
}

function normalize(raw: Partial<LocalDatabase> | null): LocalDatabase {
  const base = JSON.parse(JSON.stringify(EMPTY_LOCAL_DB)) as LocalDatabase;
  if (!raw) return base;

  const tutorChats = Array.isArray(raw.tutor_chats)
    ? raw.tutor_chats
        .map((chat) => normalizeTutorChat(chat as Partial<TutorChat>))
        .filter((chat): chat is TutorChat => !!chat)
    : [];

  return {
    subjects: raw.subjects ?? [],
    flashcards: raw.flashcards ?? {},
    pdfs: Array.isArray(raw.pdfs)
      ? raw.pdfs.map((p) => ({
          ...p,
          keep: p.keep === true,
          used_for_flashcards: p.used_for_flashcards === true,
          bytes: typeof p.bytes === 'number' ? p.bytes : undefined,
        }))
      : [],
    progress: {
      flashcards_reviewed: raw.progress?.flashcards_reviewed ?? 0,
      quiz_average: raw.progress?.quiz_average ?? 0,
      focus_hours: raw.progress?.focus_hours ?? 0,
      quizzes_taken: raw.progress?.quizzes_taken ?? 0,
    },
    quizzes: raw.quizzes ?? [],
    deadlines: Array.isArray(raw.deadlines) ? raw.deadlines : [],
    tutor_chats: tutorChats,
    activity_days: normalizeActivityDays(raw.activity_days),
    settings: {
      cloud_sync_enabled: raw.settings?.cloud_sync_enabled ?? false,
      daily_goal_minutes: raw.settings?.daily_goal_minutes ?? 25,
      delete_sources_after_flashcards:
        raw.settings?.delete_sources_after_flashcards ?? false,
    },
    next_subject_id: raw.next_subject_id ?? 1,
    next_card_id: raw.next_card_id ?? 1,
    next_pdf_id: raw.next_pdf_id ?? 1,
    next_deadline_id: raw.next_deadline_id ?? 1,
    next_tutor_chat_id: raw.next_tutor_chat_id ?? 1,
  };
}

export async function loadLocalDb(): Promise<LocalDatabase> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (!json) return normalize(null);
    return normalize(JSON.parse(json) as Partial<LocalDatabase>);
  } catch {
    return normalize(null);
  }
}

export async function saveLocalDb(db: LocalDatabase): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export async function updateLocalDb(
  mutator: (db: LocalDatabase) => void | LocalDatabase,
): Promise<LocalDatabase> {
  const db = await loadLocalDb();
  const result = mutator(db);
  const next = result ?? db;
  await saveLocalDb(next);
  return next;
}

export async function resetLocalDb(): Promise<LocalDatabase> {
  const empty = normalize(null);
  await saveLocalDb(empty);
  return empty;
}
