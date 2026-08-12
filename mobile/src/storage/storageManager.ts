import type { StoredSource } from './schema';
import { fileSizeBytes, listStoredSources } from './pdfs';
import { loadLocalDb } from './store';

export type StorageBreakdown = {
  pdfs_bytes: number;
  photos_bytes: number;
  flashcards_bytes: number;
  ai_data_bytes: number;
  total_bytes: number;
  sources: Array<
    StoredSource & {
      bytes: number;
      category: 'pdf' | 'photo';
    }
  >;
  auto_delete_enabled: boolean;
};

function utf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function isPhotoSource(source: StoredSource): boolean {
  return source.source_type === 'photo';
}

/**
 * Measure on-device Study Buddy storage by category.
 * Source file sizes come from disk; flashcards/AI data from local DB JSON size.
 */
export async function getStorageBreakdown(): Promise<StorageBreakdown> {
  const db = await loadLocalDb();
  const sources = await listStoredSources();

  let pdfs_bytes = 0;
  let photos_bytes = 0;
  const detailed: StorageBreakdown['sources'] = [];

  for (const source of sources) {
    const bytes =
      typeof source.bytes === 'number' && source.bytes > 0
        ? source.bytes
        : await fileSizeBytes(source.uri);
    const category = isPhotoSource(source) ? 'photo' : 'pdf';
    if (category === 'photo') photos_bytes += bytes;
    else pdfs_bytes += bytes;
    detailed.push({ ...source, bytes, category });
  }

  // Refresh cached sizes when missing.
  if (detailed.some((s, i) => (sources[i]?.bytes ?? 0) !== s.bytes)) {
    const { updateLocalDb } = await import('./store');
    await updateLocalDb((next) => {
      for (const row of detailed) {
        const match = next.pdfs.find((p) => p.id === row.id);
        if (match) match.bytes = row.bytes;
      }
    });
  }

  const flashcards_bytes = utf8Bytes({
    subjects: db.subjects,
    flashcards: db.flashcards,
  });
  const ai_data_bytes = utf8Bytes({
    tutor_chats: db.tutor_chats,
    quizzes: db.quizzes,
    activity_days: db.activity_days,
    progress: db.progress,
  });

  const total_bytes =
    pdfs_bytes + photos_bytes + flashcards_bytes + ai_data_bytes;

  return {
    pdfs_bytes,
    photos_bytes,
    flashcards_bytes,
    ai_data_bytes,
    total_bytes,
    sources: detailed.sort((a, b) => b.bytes - a.bytes),
    auto_delete_enabled: db.settings.delete_sources_after_flashcards,
  };
}
