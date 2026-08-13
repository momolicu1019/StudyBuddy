# StudyBuddy AI

Cross-platform study companion for **iOS** and **Android**, built with:

- **React Native (Expo)** — mobile UI
- **Local-first storage** — flashcards, subjects, PDFs, progress, quizzes, and settings on device
- **Optional cloud** — backup / account / sync / devices (stubs + optional FastAPI)

## Architecture

```
Study Buddy
├── Local Storage (primary)
│   ├── Flashcards
│   ├── Subjects
│   ├── PDFs / photos
│   ├── Progress
│   ├── Quizzes
│   └── Settings
└── Optional Cloud
    ├── Backup
    ├── Account
    ├── Sync
    └── Devices
```

On-device code lives in `mobile/src/storage/`. Sign in is optional via the login screen; PDF backup/restore is available from the avatar menu (`Backup now` / `Restore`).

## Features

- Optional **Continue with Google** or email login
- **Per-account on-device data** — each Google/email login keeps its own folders, flashcards, and progress on this device
- **Google Drive sync** — Sync up / Sync down from the profile menu (private Drive app data)
- Dashboard with note upload (PDF / photo) → generate flashcards → save to a folder
- Subject folders (create, rename, delete, search)
- Flashcard study mode
- Quiz mode with scoring
- AI Tutor chat (on-device helpers)
- **Student Messages** — 1:1 DMs + group chats via Firebase Auth + Cloud Firestore (chat icon next to profile), with push notifications for new messages and in-thread group rename
- Pomodoro focus timer
- Study progress stats

## Project structure

```
mobile/           Expo React Native app (iOS + Android) + local storage + Google login
backend/          Optional FastAPI cloud API (not required for local use)
```

## Mobile app setup

```bash
cd mobile
npm install
npm start
```

Then press:

- `i` for iOS simulator (macOS)
- `a` for Android emulator
- scan the QR code with Expo Go on a physical device

### Login & Google sign-in

1. On first launch, choose **Continue with Google**, create an email account, or **Continue without an account**.
2. Study content (folders, flashcards, progress, sources) is stored **per account on this device**. Sign in with Google A, then Google B → each sees only their own data. Guest / skip-login uses a separate guest profile.
3. From the avatar menu, Google accounts can **Sync up to Google** / **Sync down from Google** (private Drive app-data folder). PDF **Backup now** / **Restore** remain available as file exports.
4. Tap the avatar (top right) anytime to manage sync, PDF backup, or sign out.
5. **Expo Go** cannot run real Google Sign-In (Google blocks the old browser OAuth redirect). Use an EAS **development** or **preview** build.
6. Without Google Cloud credentials (or without a native build), the app uses a **demo Google session** so you can exercise the UI on-device.
7. For real Google Sign-In, copy `mobile/.env.example` → `mobile/.env` and configure Google Cloud:

```bash
# Required — OAuth client type "Web application"
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com

# Optional until you ship iOS — OAuth client type "iOS", bundle com.studybuddy.ai
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com

# Optional note — Android matching uses package + SHA-1 in Google Cloud,
# not this env var. You can still record the Android client ID here for reference.
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your-android-client-id.apps.googleusercontent.com
```

Google Cloud Console checklist:

1. **APIs & Services → OAuth consent screen** — add your test users while the app is in Testing. Include the Drive scope `https://www.googleapis.com/auth/drive.appdata` (used for Sync up / Sync down).
2. **Credentials → Create credentials → OAuth client ID → Web application** — copy into `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (must be type **Web**, not Android).
3. **Credentials → OAuth client ID → Android**
   - Package name: `com.studybuddy.ai`
   - SHA-1: fingerprint of the keystore that signed the APK you installed
4. Rebuild only if you changed native deps / env baked into the binary. Fixing SHA-1 in Google Cloud does **not** require a rebuild — wait a few minutes and retry.

Google Drive sync stores a private app-data backup (folders, flashcards, progress, and source files under 12MB each). Sync down **replaces** local data for the signed-in account.

#### Fix `DEVELOPER_ERROR` after picking a Google account

That error means the Android OAuth client’s package/SHA-1 does not match the installed APK (or `webClientId` is not a Web client).

For the current EAS **preview** APK (`studybuddy_v1.0.1.apk`), the signing SHA-1 is:

```text
1B:7E:FF:3F:71:E8:DF:49:92:77:0E:AF:FE:D7:E0:94:4D:08:B4:8E
```

Paste that into an Android OAuth client with package `com.studybuddy.ai`. To print the SHA-1 for any APK:

```bash
cd mobile
npm run apk:sha1 -- /path/to/studybuddy.apk
# or: eas credentials   # shows EAS-managed keystore fingerprints
```

Then rebuild if you need a fresh install:

```bash
cd mobile
npx eas-cli build --profile preview --platform android
```

Do **not** reuse the Web client ID as an Android/iOS client ID, and do not rely on a custom `studybuddy://` browser redirect — that is what produced Google’s `Error 400: invalid_request` / OAuth policy block.

The app starts **empty** and stores data on the device. Typical study flow:

1. Upload a PDF or take a photo of your notes
2. Tap **Generate Flashcards** to turn the upload into a draft deck
3. Choose a folder to save into (or **Create folder** if none exist)
4. Saved cards appear under **My Flashcards** — study or quiz from there

## Optional cloud API

See [backend/README.md](backend/README.md) if you want to run the FastAPI service for future sync/backup work.

### Student chat (Firebase)

Messages use **Firebase**, not the FastAPI server. Setup guide: [mobile/FIREBASE_CHAT.md](mobile/FIREBASE_CHAT.md).

Copy your Firebase web config into `mobile/.env` as `EXPO_PUBLIC_FIREBASE_*`, enable Email/Password + Anonymous auth, create Firestore, and publish `mobile/firestore.rules`.


### CI builds (Android APK + iOS IPA)

Pushing changes under `mobile/` (or this workflow file) to `main` builds **Android and iOS** automatically, waits for EAS to finish, then publishes:

- GitHub Actions artifacts
- GitHub Release **`studybuddy_v1.0.1`** (from `app.json` → `expo.version`) with `studybuddy_v1.0.1.apk` and `studybuddy_v1.0.1.ipa`

You can still run **Actions → EAS Build → Run workflow** and pick platform `android`, `ios`, or `all`.

1. Create an Expo access token: https://expo.dev/settings/access-tokens
2. Add it as a GitHub Actions secret named `EXPO_TOKEN`
3. One-time iOS setup on your machine (Apple Developer account required) before the first CI iOS build:

```bash
cd mobile
npx eas-cli login
npx eas-cli device:create
npx eas-cli build --platform ios --profile preview
```

4. Set `EXPO_PUBLIC_GOOGLE_*` / `EXPO_PUBLIC_FIREBASE_*` / AI env vars in the Expo project environments (`preview` / `production`) so CI builds pick them up (local `mobile/.env` is not used by GitHub Actions).

Release page: **GitHub → Releases → studybuddy_v1.0.1**. Bump `expo.version` in `mobile/app.json` when you want the next tag, etc.

## Design

The mobile UI follows `study_buddy_ai_ui_prototype` look and feel:

- Primary purple `#6C63FF`
- Soft lilac backgrounds / cards
- Rounded 20px cards, dashed upload zone
- Dashboard → Flashcards → Quiz → AI Tutor → Pomodoro navigation
