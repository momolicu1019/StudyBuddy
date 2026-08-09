/**
 * App data access layer.
 *
 * Study Buddy is local-first: screens talk to `localBackend` on-device storage.
 * PDF backup/restore lives in `storage/pdfBackup.ts` (via cloud helpers).
 */
export { localBackend as api } from '../storage/localBackend';
export { backupLocalData, restoreLocalData } from '../storage/cloud';
