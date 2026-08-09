import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { zipSync } from 'fflate';

import type { Flashcard, Subject } from '../api/types';
import { localBackend } from './localBackend';
import { loadLocalDb, updateLocalDb } from './store';

export type PdfBackupResult = {
  ok: boolean;
  message: string;
  lastSyncedAt?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^\w\s\-]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return cleaned || 'Subject';
}

function subjectBackupHtml(subject: Subject, cards: Flashcard[]): string {
  const rows = cards
    .map(
      (card, index) => `
      <div class="card">
        <div class="label">Key point ${index + 1}</div>
        <div class="q">${escapeHtml(card.question)}</div>
        <div class="label">Summary</div>
        <div class="a">${escapeHtml(card.answer)}</div>
      </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 28px; color: #20243A; }
    h1 { color: #6C63FF; font-size: 28px; margin: 0 0 8px; }
    .meta { color: #73778F; font-size: 12px; margin-bottom: 22px; }
    .card { border: 1px solid #E9E9F2; border-radius: 12px; padding: 14px 16px; margin: 0 0 14px; page-break-inside: avoid; }
    .label { color: #6C63FF; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
    .q { font-weight: 700; font-size: 15px; margin-bottom: 10px; line-height: 1.4; }
    .a { font-size: 14px; line-height: 1.5; color: #33384F; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>${escapeHtml(`${subject.icon} ${subject.name}`)}</h1>
  <p class="meta">Study Buddy flashcard backup · ${cards.length} card${cards.length === 1 ? '' : 's'} · ${new Date().toLocaleString()}</p>
  ${rows || '<p class="meta">No flashcards in this folder.</p>'}
</body>
</html>`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function ensureBackupDir(): Promise<string> {
  const base = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!base) throw new Error('File storage is not available on this device.');
  const dir = `${base}pdf-backups/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/**
 * Export each subject folder as its own PDF, then share a zip of all PDFs.
 */
export async function exportFlashcardsAsPdfs(): Promise<PdfBackupResult> {
  const db = await loadLocalDb();
  const withCards = db.subjects.filter(
    (subject) => (db.flashcards[String(subject.id)] ?? []).length > 0,
  );

  if (!withCards.length) {
    return {
      ok: false,
      message: 'No flashcards to export yet. Create cards in a subject folder first.',
    };
  }

  const dir = await ensureBackupDir();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const zipEntries: Record<string, Uint8Array> = {};

  for (const subject of withCards) {
    const cards = db.flashcards[String(subject.id)] ?? [];
    const html = subjectBackupHtml(subject, cards);
    const printed = await Print.printToFileAsync({ html });
    const fileName = `${safeFileName(subject.name)}.pdf`;
    const dest = `${dir}${fileName}`;
    await FileSystem.copyAsync({ from: printed.uri, to: dest });

    const base64 = await FileSystem.readAsStringAsync(dest, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    zipEntries[fileName] = bytes;
  }

  const zipName = `StudyBuddy-backup-${stamp}.zip`;
  const zipPath = `${dir}${zipName}`;
  const zipped = zipSync(zipEntries, { level: 6 });
  await FileSystem.writeAsStringAsync(zipPath, bytesToBase64(zipped), {
    encoding: FileSystem.EncodingType.Base64,
  });

  const now = new Date().toISOString();
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(zipPath, {
      mimeType: 'application/zip',
      dialogTitle: 'Save Study Buddy PDF backup',
      UTI: 'public.zip-archive',
    });
  }

  return {
    ok: true,
    message: `Exported ${withCards.length} PDF${withCards.length === 1 ? '' : 's'} (one per subject folder). Save the zip from the share sheet.`,
    lastSyncedAt: now,
  };
}

/**
 * Pick one or more PDFs, regenerate flashcards with Gemini, and save into folders
 * named after each PDF (creating the subject when needed).
 */
export async function restoreFlashcardsFromPdfs(): Promise<PdfBackupResult> {
  const pick = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    multiple: true,
    copyToCacheDirectory: true,
  });

  if (pick.canceled || !pick.assets?.length) {
    return { ok: false, message: 'No PDF selected.' };
  }

  let folders = 0;
  let cardsSaved = 0;
  const errors: string[] = [];

  for (const asset of pick.assets) {
    const rawName = asset.name || 'Restored notes.pdf';
    const subjectName = rawName.replace(/\.pdf$/i, '').replace(/_/g, ' ').trim() || 'Restored notes';

    try {
      const subjects = await localBackend.getSubjects();
      let subject =
        subjects.find((s) => s.name.toLowerCase() === subjectName.toLowerCase()) ??
        null;

      if (!subject) {
        subject = await localBackend.createSubject(subjectName, '📚');
      } else {
        // Replace existing cards so restore does not duplicate.
        await updateLocalDb((db) => {
          const found = db.subjects.find((s) => s.id === subject!.id);
          if (!found) return;
          db.flashcards[String(found.id)] = [];
          found.cards = 0;
          found.mastered = 0;
          found.last = 'Not studied yet';
        });
      }

      const draft = await localBackend.generateFlashcards(
        'pdf',
        rawName,
        asset.uri,
      );
      if (!draft.cards.length) {
        errors.push(`${subjectName}: no cards generated`);
        continue;
      }

      await localBackend.saveFlashcards(subject.id, draft.cards);
      folders += 1;
      cardsSaved += draft.cards.length;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed';
      errors.push(`${subjectName}: ${detail}`);
    }
  }

  if (!folders) {
    return {
      ok: false,
      message:
        errors[0] ||
        'Could not restore flashcards from the selected PDF(s). Check your Gemini key and try again.',
    };
  }

  const extra = errors.length ? ` (${errors.length} file(s) failed)` : '';
  return {
    ok: true,
    message: `Restored ${cardsSaved} flashcard${cardsSaved === 1 ? '' : 's'} into ${folders} folder${folders === 1 ? '' : 's'} from PDF${extra}.`,
    lastSyncedAt: new Date().toISOString(),
  };
}
