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

/** @type {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const base = appJson.expo ?? config;
  return {
    ...base,
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
    },
  };
};