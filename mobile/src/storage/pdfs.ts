import * as FileSystem from 'expo-file-system/legacy';

import type { StoredSource } from './schema';
import type { SourceKind } from './sourceMime';
import {
  getActiveStorageScope,
  loadLocalDb,
  sourcesDirForScope,
  updateLocalDb,
} from './store';

function sourcesDir(): string {
  return sourcesDirForScope(getActiveStorageScope());
}

async function ensureSourcesDir(): Promise<string> {
  const dir = sourcesDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

async function fileSizeBytes(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === 'number') return info.size;
  } catch {
    // ignore
  }
  return 0;
}

/**
 * Persist an uploaded study file into on-device storage.
 * Returns the local copy metadata recorded in the database.
 *
 * New files are kept by default via the auto-delete setting (off).
 * Students can mark individual files Keep so they survive cleanup.
 */
export async function persistSourceFile(input: {
  name: string;
  sourceType: SourceKind;
  uri: string;
  subjectId?: number;
}): Promise<StoredSource> {
  const dir = await ensureSourcesDir();
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const stamp = Date.now();
  const dest = `${dir}${stamp}_${safeName}`;

  await FileSystem.copyAsync({ from: input.uri, to: dest });
  const bytes = await fileSizeBytes(dest);

  let stored!: StoredSource;
  await updateLocalDb((db) => {
    stored = {
      id: db.next_pdf_id,
      name: input.name,
      source_type: input.sourceType,
      uri: dest,
      original_uri: input.uri,
      created_at: new Date().toISOString(),
      subject_id: input.subjectId,
      bytes,
      keep: false,
      used_for_flashcards: false,
    };
    db.next_pdf_id += 1;
    db.pdfs.push(stored);
  });

  return stored;
}

export async function listStoredSources(): Promise<StoredSource[]> {
  const db = await loadLocalDb();
  return db.pdfs;
}

export async function markSourceUsedForFlashcards(
  sourceId: number,
  subjectId?: number,
): Promise<StoredSource | null> {
  let updated: StoredSource | null = null;
  await updateLocalDb((db) => {
    const source = db.pdfs.find((p) => p.id === sourceId);
    if (!source) return;
    source.used_for_flashcards = true;
    if (subjectId != null) source.subject_id = subjectId;
    updated = { ...source };
  });
  return updated;
}

export async function setSourceKeep(
  sourceId: number,
  keep: boolean,
): Promise<StoredSource> {
  let updated!: StoredSource;
  await updateLocalDb((db) => {
    const source = db.pdfs.find((p) => p.id === sourceId);
    if (!source) throw new Error('Source file not found');
    source.keep = keep;
    updated = { ...source };
  });
  return updated;
}

/**
 * Delete a stored source copy from disk + DB.
 * Does not touch flashcards.
 */
export async function deleteStoredSource(sourceId: number): Promise<void> {
  const db = await loadLocalDb();
  const source = db.pdfs.find((p) => p.id === sourceId);
  if (!source) throw new Error('Source file not found');

  try {
    const info = await FileSystem.getInfoAsync(source.uri);
    if (info.exists) {
      await FileSystem.deleteAsync(source.uri, { idempotent: true });
    }
  } catch {
    // Still remove the DB row if the file is already gone.
  }

  await updateLocalDb((next) => {
    next.pdfs = next.pdfs.filter((p) => p.id !== sourceId);
  });
}

/**
 * Remove source copies that already produced flashcards and are not marked Keep.
 * Flashcards are never deleted.
 */
export async function deleteDisposableSources(): Promise<{
  deleted: number;
  bytes_freed: number;
}> {
  const db = await loadLocalDb();
  const targets = db.pdfs.filter(
    (p) => p.used_for_flashcards === true && p.keep !== true,
  );

  let bytes_freed = 0;
  for (const source of targets) {
    bytes_freed += source.bytes ?? (await fileSizeBytes(source.uri));
    try {
      await FileSystem.deleteAsync(source.uri, { idempotent: true });
    } catch {
      // continue
    }
  }

  const ids = new Set(targets.map((t) => t.id));
  await updateLocalDb((next) => {
    next.pdfs = next.pdfs.filter((p) => !ids.has(p.id));
  });

  return { deleted: targets.length, bytes_freed };
}

/**
 * After flashcards are saved: optionally drop the source copy when the
 * auto-delete setting is on and the file is not marked Keep.
 */
export async function maybeDeleteSourceAfterFlashcards(
  sourceId: number | null | undefined,
): Promise<boolean> {
  if (sourceId == null) return false;
  const db = await loadLocalDb();
  if (!db.settings.delete_sources_after_flashcards) return false;
  const source = db.pdfs.find((p) => p.id === sourceId);
  if (!source || source.keep === true) return false;
  await deleteStoredSource(sourceId);
  return true;
}

export { fileSizeBytes, sourcesDir };
