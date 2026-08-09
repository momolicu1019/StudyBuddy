import * as FileSystem from 'expo-file-system/legacy';

import type { StoredSource } from './schema';
import type { SourceKind } from './sourceMime';
import { updateLocalDb } from './store';

function sourcesDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error('File system is not available on this platform');
  }
  return `${base}studybuddy/sources/`;
}

async function ensureSourcesDir(): Promise<string> {
  const dir = sourcesDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Persist an uploaded study file into on-device storage.
 * Returns the local copy metadata recorded in the database.
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
    };
    db.next_pdf_id += 1;
    db.pdfs.push(stored);
  });

  return stored;
}

export async function listStoredSources(): Promise<StoredSource[]> {
  const { loadLocalDb } = await import('./store');
  const db = await loadLocalDb();
  return db.pdfs;
}
