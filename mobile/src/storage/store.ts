import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { EMPTY_LOCAL_DB, type ActivityDay, type LocalDatabase, type TutorChat } from './schema';

/** Pre-account-scoping AsyncStorage key (migrated once into a scoped key). */
export const LEGACY_STORAGE_KEY = 'studybuddy.local.v1';

/** Namespace used while skipped / signed out (device guest profile). */
export const GUEST_STORAGE_SCOPE = 'guest';

const MIGRATION_FLAG_KEY = 'studybuddy.local.scope-migrated.v1';

let activeScopeId = GUEST_STORAGE_SCOPE;

export function sanitizeStorageScope(scopeId: string): string {
  const cleaned = scopeId.trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned.slice(0, 120) || GUEST_STORAGE_SCOPE;
}

export function getActiveStorageScope(): string {
  return activeScopeId;
}

export function storageKeyForScope(scopeId: string): string {
  return `studybuddy.local.v1.${sanitizeStorageScope(scopeId)}`;
}

export function sourcesRootDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error('File system is not available on this platform');
  }
  return `${base}studybuddy/sources/`;
}

export function sourcesDirForScope(scopeId: string): string {
  return `${sourcesRootDir()}${sanitizeStorageScope(scopeId)}/`;
}

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

async function rewriteLegacySourceUris(
  db: LocalDatabase,
  scopeId: string,
): Promise<LocalDatabase> {
  const legacyPrefix = sourcesRootDir();
  const scopedDir = sourcesDirForScope(scopeId);
  const scopedPrefix = scopedDir;

  // Already under this scope — nothing to move.
  const needsMove = db.pdfs.some(
    (p) =>
      typeof p.uri === 'string' &&
      p.uri.startsWith(legacyPrefix) &&
      !p.uri.startsWith(scopedPrefix),
  );
  if (!needsMove) return db;

  try {
    const info = await FileSystem.getInfoAsync(scopedDir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(scopedDir, { intermediates: true });
    }
  } catch {
    return db;
  }

  const nextPdfs = [];
  for (const pdf of db.pdfs) {
    if (
      typeof pdf.uri !== 'string' ||
      !pdf.uri.startsWith(legacyPrefix) ||
      pdf.uri.startsWith(scopedPrefix)
    ) {
      nextPdfs.push(pdf);
      continue;
    }

    const fileName = pdf.uri.slice(legacyPrefix.length).replace(/^\/+/, '');
    // Skip if somehow already nested under another account folder name.
    if (fileName.includes('/')) {
      nextPdfs.push(pdf);
      continue;
    }

    const dest = `${scopedDir}${fileName}`;
    try {
      const srcInfo = await FileSystem.getInfoAsync(pdf.uri);
      if (srcInfo.exists) {
        const destInfo = await FileSystem.getInfoAsync(dest);
        if (!destInfo.exists) {
          await FileSystem.moveAsync({ from: pdf.uri, to: dest });
        }
        nextPdfs.push({ ...pdf, uri: dest });
        continue;
      }
    } catch {
      // Keep original URI if move fails.
    }
    nextPdfs.push(pdf);
  }

  return { ...db, pdfs: nextPdfs };
}

/**
 * One-time migration: claim the pre-scoping shared DB (+ flat source files)
 * into the first active account/guest namespace that is still empty.
 */
async function migrateLegacyDataIfNeeded(scopeId: string): Promise<void> {
  try {
    const migrated = await AsyncStorage.getItem(MIGRATION_FLAG_KEY);
    const legacyJson = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyJson) {
      if (!migrated) {
        await AsyncStorage.setItem(MIGRATION_FLAG_KEY, new Date().toISOString());
      }
      return;
    }

    const key = storageKeyForScope(scopeId);
    const existing = await AsyncStorage.getItem(key);
    if (!existing) {
      let db = normalize(JSON.parse(legacyJson) as Partial<LocalDatabase>);
      db = await rewriteLegacySourceUris(db, scopeId);
      await AsyncStorage.setItem(key, JSON.stringify(db));
    }

    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    await AsyncStorage.setItem(MIGRATION_FLAG_KEY, new Date().toISOString());
  } catch {
    // Best-effort; scoped empty DB is safer than crashing startup.
  }
}

/**
 * Switch the active on-device data namespace.
 * Call on sign-in / skip / sign-out before reading or writing study data.
 */
export async function setActiveStorageScope(scopeId: string): Promise<string> {
  const next = sanitizeStorageScope(scopeId);
  await migrateLegacyDataIfNeeded(next);
  activeScopeId = next;
  return activeScopeId;
}

export async function loadLocalDb(): Promise<LocalDatabase> {
  try {
    const json = await AsyncStorage.getItem(storageKeyForScope(activeScopeId));
    if (!json) return normalize(null);
    return normalize(JSON.parse(json) as Partial<LocalDatabase>);
  } catch {
    return normalize(null);
  }
}

export async function saveLocalDb(db: LocalDatabase): Promise<void> {
  await AsyncStorage.setItem(storageKeyForScope(activeScopeId), JSON.stringify(db));
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
