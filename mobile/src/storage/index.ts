export { localBackend } from './localBackend';
export {
  backupLocalData,
  clearAuthState,
  createLocalAccount,
  getGoogleOAuthConfig,
  getGoogleWebClientId,
  isGoogleOAuthConfigured,
  loadAuthState,
  restoreLocalData,
  saveAuthState,
  signInLocalAccount,
} from './cloud';
export type {
  GoogleUser,
  GoogleOAuthConfig,
  AuthUser,
  AuthSession,
  CloudActionResult,
} from './cloud';
export { loadLocalDb, resetLocalDb } from './store';
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
