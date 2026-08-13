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

In Firestore → **Rules**, paste the contents of `firestore.rules` from this folder and **Publish**.

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

- DM: **New message from Ada** (or **New messages from Ada** if they already had unread)
- Group: **New message from Bio study crew**

How it works:

1. Signing in (header / Messages) requests notification permission, creates the Android `chat-messages` channel, and stores an Expo push token on `chatUsers/{uid}.expoPushTokens`
2. On send, the sender fans out via Expo’s push API (`https://exp.host/--/api/v2/push/send`) — no Cloud Functions required
3. Separately, if the recipient’s app process is alive, Firestore unread updates also trigger a **local** OS banner (same path as deadline reminders). This works even when Expo→FCM remote delivery is misconfigured
4. Tapping the notification opens that chat thread

#### Closed / force-killed apps (required setup)

Local banners only work while the app process is alive. **Force-killed / swiped-away apps need remote Expo → FCM/APNs delivery.** Complete all of these, then **rebuild and reinstall**:

1. **Firebase → Android app**
   - Firebase Console → Project settings → Add app → Android
   - Package name: `com.studybuddy.ai`
   - Repo already includes `mobile/google-services.json` for this package
2. **google-services.json**
   - Committed at `mobile/google-services.json` and referenced by `android.googleServicesFile`
   - If you re-download from Firebase, replace that file (package must stay `com.studybuddy.ai`)
3. **EAS FCM V1 credentials (Android)**
   - Firebase Console → Project settings → Service accounts → **Generate new private key**
   - Upload that JSON in EAS: Android → **FCM V1 service account key**
   - In [Google Cloud IAM](https://console.cloud.google.com/iam-admin/iam) for the same project, the service account needs role **Firebase Cloud Messaging API Admin**
   - In Google Cloud → **APIs & Services**, enable **Firebase Cloud Messaging API**
   - Never commit the private-key JSON to GitHub
4. **EAS APNs key (iOS)**
   - Create an Apple Push Notifications key and upload it in EAS iOS credentials
5. Install a **new** preview/production APK from the latest GitHub Release / EAS build — Expo Go cannot deliver killed-app chat pushes
6. Open StudyBuddy **once** while signed in (registers the Expo push token), then force-close and test
7. On **Messages**, use **Test push on this phone** — you should see a banner immediately. If you get an error toast, fix that first (usually FCM V1 on EAS / wrong APK)

#### Still not getting closed-app alerts?

1. Confirm both phones installed **v1.0.2+** from the latest GitHub Release (not an older same-named APK left on the phone)
2. On Messages, tap **Test push on this phone**
   - If that fails, the toast names the Expo/FCM problem
   - If that works, Expo→FCM is fine — swipe the app away from recents (**do not** use Android Settings → Force stop; that blocks FCM until the app is opened again)
3. On the **recipient**, Firebase Console → Firestore → `chatUsers/{uid}` → `expoPushTokens` must contain at least one `ExponentPushToken[...]`
   - If the array is **empty**, closed-app classmate notifications cannot work (even if the phone briefly showed Ready). Re-open Messages / tap Test push after installing a build that persists the token without re-fetching FCM
4. Send a chat from another account with the recipient swiped away — the **sender** shows a toast if Expo reports `InvalidCredentials`, missing token, etc.
5. Manually test Expo delivery with the recipient token:

```bash
curl -H "Content-Type: application/json" -X POST "https://exp.host/--/api/v2/push/send" -d '{
  "to": "ExponentPushToken[PASTE_TOKEN]",
  "title": "Test",
  "body": "Closed-app push check",
  "priority": "high"
}'
```

Then fetch the receipt id from the response via `https://exp.host/--/api/v2/push/getReceipts`. `InvalidCredentials` means the FCM V1 key on EAS is wrong/incomplete; `ok` means Expo handed off to FCM and the device/OS is the next place to check.

#### `Unable to resolve host "exp.host"`

The phone got past FCM device-token fetch, but **cannot DNS-resolve Expo’s servers**. Closed-app registration needs `exp.host`.

Try:

1. Switch **Wi‑Fi ↔ mobile data**
2. Turn off **VPN**
3. Android Settings → Network → Private DNS → **Off** or **Automatic** (not a broken custom DNS)
4. Forget/rejoin Wi‑Fi, or try another network
5. Open a browser to confirm general internet works, then tap **Test push** again

#### `SERVICE_NOT_AVAILABLE` on Test push

That error is from **Google Play Services on the phone**, not from missing EAS credentials. The app never got a native FCM token, so closed-app push cannot work yet.

Try on the phone:

1. Stable internet (try toggling Wi‑Fi / mobile data)
2. Update **Google Play Services** (Play Store → profile → Settings → About → Update Play services)
3. Sign in with a **Google account** on the device
4. Settings → System → Date & time → **Automatic date & time** ON
5. Reopen StudyBuddy and tap **Test push on this phone** again
6. Do **not** use Settings → Apps → StudyBuddy → **Force stop** (that can keep FCM blocked)

If it still fails on one phone but works on another, the failing device’s Play Services / network / OEM restrictions are the blocker.

### Google Drive sync (chat backup)

**Sync up to Google** also snapshots your Student Messages (DMs + groups, up to 200 messages each) into the same private Drive app-data file as folders/flashcards.

**Sync down from Google** restores study data locally and **re-adds** any missing conversations/messages into Firestore (merge — does not wipe live chats).

Republish `firestore.rules` so restored messages (`restored: true`) are allowed.
