/**
 * App data access layer.
 *
 * Study Buddy is local-first: screens talk to `localBackend` on-device storage.
 * Optional Google account backup/sync lives in `storage/cloud.ts`.
 */
export { localBackend as api } from '../storage/localBackend';
export {
  backupLocalData,
  isGoogleOAuthConfigured,
  restoreLocalData,
} from '../storage/cloud';
