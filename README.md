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
- Dashboard with note upload (PDF / photo) → generate flashcards → save to a folder
- Subject folders (create, rename, delete, search)
- Flashcard study mode
- Quiz mode with scoring
- AI Tutor chat (on-device helpers)
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
2. Tap the avatar (top right) anytime to manage PDF **Backup now** / **Restore**, or sign out.
3. Without Google Cloud credentials the app uses a **demo Google session** so you can exercise the UI on-device.
4. For real Google OAuth, copy `mobile/.env.example` → `mobile/.env` and set:

```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

Add OAuth redirect URIs for Expo / your app scheme `studybuddy` in Google Cloud Console.

The app starts **empty** and stores data on the device. Typical study flow:

1. Upload a PDF or take a photo of your notes
2. Tap **Generate Flashcards** to turn the upload into a draft deck
3. Choose a folder to save into (or **Create folder** if none exist)
4. Saved cards appear under **My Flashcards** — study or quiz from there

## Optional cloud API

See [backend/README.md](backend/README.md) if you want to run the FastAPI service for future sync/backup work.

### CI builds (Android APK + iOS IPA)

Pushing changes under `mobile/` to `main` builds **Android** automatically, waits for EAS to finish, then publishes:

- GitHub Actions artifact
- GitHub Release **`studybuddy_v1.0.0`** (from `app.json` → `expo.version`) with `studybuddy_v1.0.0.apk`

**iOS** IPA (`studybuddy_v1.0.0.ipa`) is added to the same release after you create Apple credentials once and run the workflow with platform `ios` or `all`.

1. Create an Expo access token: https://expo.dev/settings/access-tokens
2. Add it as a GitHub Actions secret named `EXPO_TOKEN`
3. One-time iOS setup on your machine (Apple Developer account required):

```bash
cd mobile
npx eas-cli login
npx eas-cli device:create
npx eas-cli build --platform ios --profile preview
```

Release page: **GitHub → Releases → studybuddy_v1.0.0**. Bump `expo.version` in `mobile/app.json` when you want `studybuddy_v1.0.1`, etc.

## Design

The mobile UI follows `study_buddy_ai_ui_prototype` look and feel:

- Primary purple `#6C63FF`
- Soft lilac backgrounds / cards
- Rounded 20px cards, dashed upload zone
- Dashboard → Flashcards → Quiz → AI Tutor → Pomodoro navigation
