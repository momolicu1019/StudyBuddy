# Firebase student chat setup

StudyBuddy student messaging (1:1 DMs + group communities) uses **Firebase Authentication + Cloud Firestore** (no FastAPI URL required).

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

From the repo root (preferred):

```bash
firebase deploy --only firestore:rules
```

Or in Firestore → **Rules**, paste the contents of `mobile/firestore.rules` and **Publish**.

Also add a composite-friendly query note: conversations are queried with

`memberIds` **array-contains** current uid — no extra index is usually required for that single-field query.

The mobile app initializes Firestore with **long-polling** (`experimentalForceLongPolling`) so live listeners work reliably in Expo / React Native. Without that, receivers often only see new messages after reopening a chat.

## 4. Point the mobile app

After `.env` is filled, open **Messages** while signed in with Google or email. The first open creates the Firebase chat profile. Classmates must open Messages once before you can DM their email.

## 5. EAS / production builds

Add the same `EXPO_PUBLIC_FIREBASE_*` variables to Expo project environments (`preview` / `production`). Local `mobile/.env` is not used by GitHub Actions.

## Troubleshooting

### `Missing or insufficient permissions` when starting a chat

That Firestore error means the security rules denied a read/write.

1. Open **Firebase Console → Firestore → Rules**
2. Paste the latest `mobile/firestore.rules` from this repo
3. Click **Publish** (draft rules do nothing until published)
4. Confirm **Authentication** has Email/Password (+ Anonymous) enabled
5. Both students must open **Messages** once so their `chatUsers` / `chatEmails` profiles exist
6. Retry **New chat** with the classmate’s Study Buddy email

Starting a DM previously called `getDoc` on a conversation that did not exist yet. Rules that only checked `request.auth.uid in resource.data.memberIds` fail when `resource` is null — publish the updated rules (or use a build that includes the client fallback) to fix it.

### Group chats

- Tap **New group**, enter a community name, and add friends by Study Buddy email
- Each friend must have opened **Messages** at least once (same as DMs)
- Groups are stored as `chatConversations` docs with `type: "group"` (auto-generated ids)
- Open a group and tap the pencil in the header to **rename** it — any member can update the name
- Open a group and tap the **person-add** icon to **invite more members** by email (membership only grows; max 20)
- Tap the **exit** icon on a group (inbox row or thread header) to **leave** — confirms first, then removes you from the group and your inbox
- Long-press any conversation in the inbox to **delete** it from your chat box (soft-hide; reopen from Friends / New chat)
- The **Friends** dropdown beside **New group** lists emails from past chats — tap one to start a DM
- The inbox and group thread header show the current **member count**
- Republish `firestore.rules` after pulling this update — older rules only allow 2-member DMs / title-only group edits

### Push notifications (new messages)

When someone sends a chat message, classmates get a phone notification:

- DM: **New message from Ada**
- Group: **New message from Bio study crew**

How it works (current architecture):

1. Signing in requests notification permission, creates the Android `chat-messages` channel, and stores a **native FCM token** on `chatUsers/{uid}.fcmTokens`
2. Sending a message only writes to Firestore (fast). A Cloud Function (`sendChatNotification`) watches new messages and fans out via the Firebase Admin SDK → FCM
3. If the recipient’s app process is alive, Firestore unread updates also trigger a **local** OS banner (same path as deadline reminders)
4. Tapping the notification opens that chat thread

#### Deploy (required for closed-app push)

From the repo root (Firebase CLI logged into project `studybuddy-7a88d`):

```bash
# Publish rules (also paste mobile/firestore.rules in Console → Publish)
firebase deploy --only firestore:rules

# Install + deploy the chat FCM Cloud Function
cd functions && npm install && cd ..
firebase deploy --only functions
```

Without the published rules + deployed function, tokens may fail to save and killed-app push will not fire.

#### Closed / force-killed apps (device setup)

1. **Firebase → Android app** with package `com.studybuddy.ai` (repo includes `mobile/google-services.json`)
2. Install a **preview/production APK** from EAS / GitHub Release — **Expo Go cannot deliver killed-app FCM**
3. Open StudyBuddy while signed in (or tap **Fix notifications** on Messages) so `fcmTokens` is written
4. Force-close by swiping away from recents (**do not** use Settings → Force stop)
5. Have a classmate send a message

#### Still not getting closed-app alerts?

1. On Messages, tap **Fix notifications**
   - Success toast = FCM token saved; you should also see a local smoke-test banner
   - Error toast names the real problem (permission, Play Services timeout, Firestore rules, etc.)
2. On the **recipient**, Firebase Console → Firestore → `chatUsers/{uid}` → `fcmTokens` must be a non-empty list of native FCM strings (not `ExponentPushToken[...]`)
3. Confirm Cloud Function logs: Firebase Console → Functions → `sendChatNotification` → Logs
   - `Recipient has no FCM tokens` means registration never saved on that phone
4. Check Play Services / network on the failing device (`SERVICE_NOT_AVAILABLE`, token timeouts)

#### `Could not save FCM token`

Usually Firestore security rules are outdated or unpublished:

1. Paste the latest `mobile/firestore.rules` → **Publish**
2. Reopen Messages and tap **Fix notifications**

#### `SERVICE_NOT_AVAILABLE` / FCM token timed out

That error is from **Google Play Services on the phone**, not from missing EAS Expo credentials. The app never got a native FCM token.

Try on the phone:

1. Stable internet (toggle Wi‑Fi / mobile data)
2. Update **Google Play Services**
3. Sign in with a **Google account** on the device
4. Automatic date & time ON
5. Reopen StudyBuddy → **Fix notifications**
6. Do **not** use Settings → Apps → StudyBuddy → **Force stop**

### Google Drive sync (chat backup)

**Sync up to Google** also snapshots your Student Messages (DMs + groups, up to 200 messages each) into the same private Drive app-data file as folders/flashcards.

**Sync down from Google** restores study data locally and **re-adds** any missing conversations/messages into Firestore (merge — does not wipe live chats).

Republish `firestore.rules` so restored messages (`restored: true`) are allowed.
