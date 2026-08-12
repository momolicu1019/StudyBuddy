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
3. **Expo Go** cannot run real Google Sign-In (Google blocks the old browser OAuth redirect). Use an EAS **development** or **preview** build.
4. Without Google Cloud credentials (or without a native build), the app uses a **demo Google session** so you can exercise the UI on-device.
5. For real Google Sign-In, copy `mobile/.env.example` → `mobile/.env` and configure Google Cloud:

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

1. **APIs & Services → OAuth consent screen** — add your test users while the app is in Testing.
2. **Credentials → Create credentials → OAuth client ID → Web application** — copy into `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
3. **Credentials → OAuth client ID → Android**
   - Package name: `com.studybuddy.ai`
   - SHA-1: from EAS (`eas credentials`) or your upload keystore (`keytool -list -v -keystore ...`)
4. Rebuild after installing `@react-native-google-signin/google-signin` / changing env:

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
