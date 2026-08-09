const appJson = require('./app.json');

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
      aiModel: process.env.EXPO_PUBLIC_AI_MODEL || 'gemini-2.0-flash',
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
      googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
      googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
    },
  };
};