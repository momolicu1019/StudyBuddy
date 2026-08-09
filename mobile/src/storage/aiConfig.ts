import Constants from 'expo-constants';

type Extra = {
  aiApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
};

function readExtra(): Extra {
  const extra =
    (Constants.expoConfig?.extra as Extra | undefined) ||
    ((Constants as { manifest?: { extra?: Extra } }).manifest?.extra as
      | Extra
      | undefined) ||
    {};
  return extra ?? {};
}

/**
 * Shared AI config. Reads Expo public env vars and app.config extra
 * so keys work reliably in Expo Go after a restart.
 */
export function getAiConfig() {
  const extra = readExtra();
  const apiKey = (
    process.env.EXPO_PUBLIC_AI_API_KEY ||
    process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
    extra.aiApiKey ||
    ''
  ).trim();

  const baseUrl = (
    process.env.EXPO_PUBLIC_AI_BASE_URL ||
    extra.aiBaseUrl ||
    'https://generativelanguage.googleapis.com/v1beta'
  )
    .trim()
    .replace(/\/$/, '');

  const model = (
    process.env.EXPO_PUBLIC_AI_MODEL ||
    extra.aiModel ||
    'gemini-2.0-flash'
  ).trim();

  return { apiKey, baseUrl, model };
}

export function isAiConfigured(): boolean {
  return Boolean(getAiConfig().apiKey);
}

export function usesGemini(): boolean {
  const { baseUrl, model } = getAiConfig();
  return (
    /generativelanguage\.googleapis\.com/i.test(baseUrl) ||
    /^gemini/i.test(model)
  );
}
