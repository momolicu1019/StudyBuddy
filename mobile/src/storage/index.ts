export { localBackend } from './localBackend';
export {
  backupLocalData,
  clearAuthState,
  createLocalAccount,
  getGoogleOAuthConfig,
  getGoogleSignInSetupHint,
  getGoogleWebClientId,
  iosUrlSchemeFromClientId,
  isExpoGoRuntime,
  isGoogleOAuthConfigured,
  isNativeGoogleSignInAvailable,
  loadAuthState,
  restoreLocalData,
  saveAuthState,
  signInLocalAccount,
} from './cloud';
export {
  GOOGLE_DRIVE_APPDATA_SCOPE,
  syncDownFromGoogleDrive,
  syncUpToGoogleDrive,
} from './googleDriveSync';
export type { GoogleDriveSyncPayload } from './googleDriveSync';
export type {
  GoogleUser,
  GoogleOAuthConfig,
  AuthUser,
  AuthSession,
  CloudActionResult,
} from './cloud';
export {
  GUEST_STORAGE_SCOPE,
  getActiveStorageScope,
  loadLocalDb,
  resetLocalDb,
  setActiveStorageScope,
  sourcesDirForScope,
  storageKeyForScope,
} from './store';
export type { LocalDatabase, AppSettings, StoredSource, Deadline, TutorChat, TutorChatMessage } from './schema';
export {
  daysUntilDue,
  formatDueDate,
  getDeadlineUrgency,
  getNearestNearingUrgency,
  needsDeadlineBulb,
  sortDeadlines,
  toIsoDate,
  urgencyTone,
} from './deadlineUtils';
export type { DeadlineUrgency, NearingUrgency, UrgencyTone } from './deadlineUtils';
