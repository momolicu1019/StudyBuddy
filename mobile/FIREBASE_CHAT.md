# Firebase student chat setup

StudyBuddy DMs use **Firebase Authentication + Cloud Firestore** (no FastAPI URL required).

## 1. Create a Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) → **Add project**
2. Register a **Web app** (</> icon) — package name for Android OAuth is still `com.studybuddy.ai`, but chat uses the **Web** Firebase config
3. Copy the `firebaseConfig` values into `mobile/.env`:

```bash
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=

# Optional extra salt for mapping StudyBuddy accounts → Firebase email auth
EXPO_PUBLIC_FIREBASE_CHAT_PEPPER=change-me-to-a-long-random-string
```

4. Restart Expo: `npx expo start -c`

## 2. Enable Auth + Firestore

1. **Build → Authentication → Sign-in method**
   - Enable **Email/Password**
   - Enable **Anonymous** (fallback for first-time link)
2. **Build → Firestore Database → Create database**
   - Start in **production mode**
   - Pick a region close to your users

## 3. Deploy security rules

In Firestore → **Rules**, paste the contents of `firestore.rules` from this folder and **Publish**.

Also add a composite-friendly query note: conversations are queried with

`memberIds` **array-contains** current uid — no extra index is usually required for that single-field query.

## 4. Point the mobile app

After `.env` is filled, open **Messages** while signed in with Google or email. The first open creates the Firebase chat profile. Classmates must open Messages once before you can DM their email.

## 5. EAS / production builds

Add the same `EXPO_PUBLIC_FIREBASE_*` variables to Expo project environments (`preview` / `production`). Local `mobile/.env` is not used by GitHub Actions.
