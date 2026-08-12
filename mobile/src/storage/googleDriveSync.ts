import * as FileSystem from 'expo-file-system/legacy';

import type { AuthUser, CloudActionResult } from './cloud';
import type { LocalDatabase, StoredSource } from './schema';
import {
  getActiveStorageScope,
  loadLocalDb,
  saveLocalDb,
  sourcesDirForScope,
} from './store';

/** Hidden Drive folder used only by this app (not visible in the user's Drive UI). */
export const GOOGLE_DRIVE_APPDATA_SCOPE =
  'https://www.googleapis.com/auth/drive.appdata';

const SYNC_FILE_NAME = 'studybuddy-sync-v1.json';
const DRIVE_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

export type GoogleDriveSyncPayload = {
  version: 1;
  exportedAt: string;
  userId: string;
  userEmail: string;
  database: LocalDatabase;
  /**
   * Source files embedded as base64 so flashcard origins can be restored.
   * Large libraries may make the sync file bigger; Drive appData allows this.
   */
  sourceFiles: Array<{
    id: number;
    name: string;
    source_type: StoredSource['source_type'];
    base64: string;
    bytes?: number;
    keep?: boolean;
    used_for_flashcards?: boolean;
    subject_id?: number;
    created_at: string;
  }>;
};

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

async function driveFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...authHeaders(accessToken),
      ...(init?.headers ?? {}),
    },
  });
}

async function findSyncFileId(accessToken: string): Promise<string | null> {
  const q = encodeURIComponent(`name = '${SYNC_FILE_NAME}' and trashed = false`);
  const res = await driveFetch(
    accessToken,
    `${DRIVE_FILES_URL}?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseDriveError(res.status, text));
  }
  const data = (await res.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

function parseDriveError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string };
    };
    const msg = parsed.error?.message || body;
    if (status === 401 || status === 403) {
      return `Google Drive permission needed. ${msg}`;
    }
    return `Google Drive error (${status}): ${msg}`;
  } catch {
    return `Google Drive error (${status}).`;
  }
}

const MAX_SOURCE_BYTES = 12 * 1024 * 1024; // skip oversized originals in sync payload

async function readSourceAsBase64(
  source: StoredSource,
): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(source.uri);
    if (!info.exists) return null;
    if (typeof info.size === 'number' && info.size > MAX_SOURCE_BYTES) {
      return null;
    }
    return FileSystem.readAsStringAsync(source.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return null;
  }
}

async function buildPayload(user: AuthUser): Promise<GoogleDriveSyncPayload> {
  const database = await loadLocalDb();
  const sourceFiles: GoogleDriveSyncPayload['sourceFiles'] = [];

  for (const source of database.pdfs) {
    const base64 = await readSourceAsBase64(source);
    if (!base64) continue;
    sourceFiles.push({
      id: source.id,
      name: source.name,
      source_type: source.source_type,
      base64,
      bytes: source.bytes,
      keep: source.keep,
      used_for_flashcards: source.used_for_flashcards,
      subject_id: source.subject_id,
      created_at: source.created_at,
    });
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    userId: user.id,
    userEmail: user.email,
    database: {
      ...database,
      // URIs are device-local; restored from sourceFiles on download.
      pdfs: [],
    },
    sourceFiles,
  };
}

async function uploadSyncFile(
  accessToken: string,
  payload: GoogleDriveSyncPayload,
  existingFileId: string | null,
): Promise<void> {
  const bodyJson = JSON.stringify(payload);
  const metadata = existingFileId
    ? { name: SYNC_FILE_NAME, mimeType: 'application/json' }
    : {
        name: SYNC_FILE_NAME,
        mimeType: 'application/json',
        parents: ['appDataFolder'],
      };

  const boundary = `studybuddy_${Date.now()}`;
  const multipart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${bodyJson}\r\n` +
    `--${boundary}--`;

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : DRIVE_UPLOAD_URL;

  const res = await driveFetch(accessToken, url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });

  if (!res.ok) {
    throw new Error(parseDriveError(res.status, await res.text()));
  }
}

async function downloadSyncPayload(
  accessToken: string,
  fileId: string,
): Promise<GoogleDriveSyncPayload> {
  const res = await driveFetch(
    accessToken,
    `${DRIVE_FILES_URL}/${fileId}?alt=media`,
  );
  if (!res.ok) {
    throw new Error(parseDriveError(res.status, await res.text()));
  }
  const data = (await res.json()) as GoogleDriveSyncPayload;
  if (!data || data.version !== 1 || !data.database) {
    throw new Error('Cloud sync file is invalid or from a newer app version.');
  }
  return data;
}

async function restorePayload(payload: GoogleDriveSyncPayload): Promise<number> {
  const scope = getActiveStorageScope();
  const dir = sourcesDirForScope(scope);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const restoredSources: StoredSource[] = [];
  for (const file of payload.sourceFiles ?? []) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const dest = `${dir}sync_${file.id}_${safeName}`;
    await FileSystem.writeAsStringAsync(dest, file.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    restoredSources.push({
      id: file.id,
      name: file.name,
      source_type: file.source_type,
      uri: dest,
      created_at: file.created_at,
      subject_id: file.subject_id,
      bytes: file.bytes,
      keep: file.keep,
      used_for_flashcards: file.used_for_flashcards,
    });
  }

  const database: LocalDatabase = {
    ...payload.database,
    pdfs: restoredSources,
  };
  await saveLocalDb(database);
  return restoredSources.length;
}

/** Upload this account's local study data to the signed-in Google Drive app data. */
export async function syncUpToGoogleDrive(
  user: AuthUser,
  accessToken: string,
): Promise<CloudActionResult> {
  if (!accessToken) {
    return {
      ok: false,
      message: 'Google access token missing. Sign out and sign in with Google again.',
    };
  }

  try {
    const payload = await buildPayload(user);
    const existingId = await findSyncFileId(accessToken);
    await uploadSyncFile(accessToken, payload, existingId);
    const when = payload.exportedAt;
    return {
      ok: true,
      message: `Synced up to Google Drive (${payload.sourceFiles.length} source file${
        payload.sourceFiles.length === 1 ? '' : 's'
      }).`,
      lastSyncedAt: when,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Could not sync up to Google Drive.',
    };
  }
}

/** Download study data from Google Drive app data into this account's local storage. */
export async function syncDownFromGoogleDrive(
  accessToken: string,
): Promise<CloudActionResult> {
  if (!accessToken) {
    return {
      ok: false,
      message: 'Google access token missing. Sign out and sign in with Google again.',
    };
  }

  try {
    const fileId = await findSyncFileId(accessToken);
    if (!fileId) {
      return {
        ok: false,
        message:
          'No Google sync found yet. Use Sync up first from a device that has your study data.',
      };
    }
    const payload = await downloadSyncPayload(accessToken, fileId);
    const sourceCount = await restorePayload(payload);
    const subjects = payload.database.subjects?.length ?? 0;
    return {
      ok: true,
      message: `Synced down from Google Drive (${subjects} folder${
        subjects === 1 ? '' : 's'
      }, ${sourceCount} source file${sourceCount === 1 ? '' : 's'}).`,
      lastSyncedAt: payload.exportedAt,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Could not sync down from Google Drive.',
    };
  }
}
