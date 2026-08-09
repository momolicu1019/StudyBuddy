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

On-device code lives in `mobile/src/storage/`. Google account backup/sync is optional via the login screen and the avatar menu (`Backup now` / `Restore`).

## Features

- Optional **Continue with Google** login for cloud backup / restore
- Dashboard with note upload (PDF / photo) → generate flashcards → save to a folder
- Subject folders (create, rename, delete, search)
- Flashcard study mode
- Quiz mode with scoring
- AI Tutor chat (on-device helpers)
- Pomodoro focus timer
- Study progress stats

## Project structure

```
mobile/           Expo React Native app (iOS + Android) + local storage + Google backup
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

### Login & Google backup

1. On first launch, choose **Continue with Google** (backup) or **Continue without backup** (local only).
2. Tap the avatar (top right) anytime to sign in, **Backup now**, or **Restore from backup**.
3. Without Google Cloud credentials the app uses a **demo Google session** so you can exercise the UI on-device.
4. For real Google Drive App Data backup, copy `mobile/.env.example` → `mobile/.env` and set:

```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

Enable the **Google Drive API** in Google Cloud Console and add OAuth redirect URIs for Expo / your app scheme `studybuddy`.

The app starts **empty** and stores data on the device. Typical study flow:

1. Upload a PDF or take a photo of your notes
2. Tap **Generate Flashcards** to turn the upload into a draft deck
3. Choose a folder to save into (or **Create folder** if none exist)
4. Saved cards appear under **My Flashcards** — study or quiz from there

## Optional cloud API

See [backend/README.md](backend/README.md) if you want to run the FastAPI service for future sync/backup work.

### CI builds (Android APK + iOS IPA)

Pushing changes under `mobile/` to `main` triggers [EAS Build](https://docs.expo.dev/build/introduction/) via GitHub Actions (`.github/workflows/eas-build.yml`). Artifacts use the `preview` profile: installable **Android APK** and **iOS IPA** (internal distribution).

1. Create an Expo access token: https://expo.dev/settings/access-tokens
2. Add it as a GitHub Actions secret named `EXPO_TOKEN` (Settings → Secrets and variables → Actions)
3. Run one interactive build locally so credentials exist for non-interactive CI:

```bash
cd mobile
npx eas-cli login
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

Build progress and download links appear in the [Expo dashboard](https://expo.dev) and the Actions run log. You can also start a build manually from the **Actions** tab (`workflow_dispatch`).

## Design

The mobile UI follows `study_buddy_ai_ui_prototype` look and feel:

- Primary purple `#6C63FF`
- Soft lilac backgrounds / cards
- Rounded 20px cards, dashed upload zone
- Dashboard → Flashcards → Quiz → AI Tutor → Pomodoro navigation
