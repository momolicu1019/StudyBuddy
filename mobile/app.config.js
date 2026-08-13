const fs = require('fs');
const path = require('path');
const appJson = require('./app.json');

/** Ensure mobile/.env is available when Expo evaluates this config. */
function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore missing/unreadable .env
  }
}

loadDotEnv();

/** Reversed iOS client ID → URL scheme for @react-native-google-signin/google-signin. */
function iosUrlSchemeFromClientId(iosClientId) {
  const id = String(iosClientId || '').trim();
  const suffix = '.apps.googleusercontent.com';
  if (!id.endsWith(suffix)) return null;
  const prefix = id.slice(0, -suffix.length);
  if (!prefix) return null;
  return `com.googleusercontent.apps.${prefix}`;
}

/**
 * Resolve google-services.json so the Android binary can register with FCM.
 * Required for chat push when the app is force-killed (Expo → FCM).
 *
 * Prefer the committed Firebase Console download at ./google-services.json.
 * Fall back to generating one from EXPO_PUBLIC_FIREBASE_* if the file is missing.
 */
function resolveAndroidGoogleServicesFile() {
  const existing = path.join(__dirname, 'google-services.json');
  if (fs.existsSync(existing)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(existing, 'utf8'));
      const clients = Array.isArray(parsed?.client) ? parsed.client : [];
      const hasAndroid = clients.some(
        (c) =>
          c?.client_info?.android_client_info?.package_name ===
          'com.studybuddy.ai',
      );
      if (hasAndroid) return './google-services.json';
    } catch {
      // fall through to generate
    }
  }

  const projectId = String(
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  ).trim();
  const apiKey = String(process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim();
  const senderId = String(
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  ).trim();
  const storageBucket = String(
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  ).trim();
  // Prefer the Android app id (1:…:android:…). Fall back to web app id only if
  // callers have not registered an Android app yet (FCM may still fail).
  const androidAppId = String(
    process.env.EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID ||
      process.env.EXPO_PUBLIC_FIREBASE_APP_ID ||
      '',
  ).trim();

  if (!projectId || !apiKey || !senderId || !androidAppId) {
    return undefined;
  }

  const generated = {
    project_info: {
      project_number: senderId,
      project_id: projectId,
      storage_bucket: storageBucket || `${projectId}.appspot.com`,
    },
    client: [
      {
        client_info: {
          mobilesdk_app_id: androidAppId,
          android_client_info: {
            package_name: 'com.studybuddy.ai',
          },
        },
        oauth_client: [],
        api_key: [{ current_key: apiKey }],
        services: {
          appinvite_service: { other_platform_oauth_client: [] },
        },
      },
    ],
    configuration_version: '1',
  };

  try {
    fs.writeFileSync(existing, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');
    return './google-services.json';
  } catch {
    return undefined;
  }
}

/** @type {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const base = appJson.expo ?? config;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
  const iosUrlScheme = iosUrlSchemeFromClientId(iosClientId);
  const googleServicesFile = resolveAndroidGoogleServicesFile();

  const plugins = [...(base.plugins ?? [])];
  if (iosUrlScheme) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme },
    ]);
  }

  const iosInfoPlist = {
    ...(base.ios?.infoPlist ?? {}),
    // Allow the OS to wake the app for remote chat pushes when backgrounded.
    UIBackgroundModes: Array.from(
      new Set([
        ...((base.ios?.infoPlist?.UIBackgroundModes) || []),
        'remote-notification',
      ]),
    ),
  };

  return {
    ...base,
    plugins,
    ios: {
      ...(base.ios ?? {}),
      infoPlist: iosInfoPlist,
    },
    android: {
      ...(base.android ?? {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    extra: {
      ...(base.extra ?? {}),
      // Loaded from mobile/.env at start time (EXPO_PUBLIC_* also inlined by Metro).
      aiApiKey:
        process.env.EXPO_PUBLIC_AI_API_KEY ||
        process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
        '',
      aiBaseUrl:
        process.env.EXPO_PUBLIC_AI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta',
      aiModel: process.env.EXPO_PUBLIC_AI_MODEL || 'gemini-flash-latest',
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
      googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
      googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
      firebaseAndroidAppId:
        process.env.EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID || '',
    },
  };
};
