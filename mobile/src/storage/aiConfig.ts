/**
 * Shared OpenAI-compatible AI config (Gemini, Groq, OpenAI, etc.).
 */
export function getAiConfig() {
  const apiKey =
    process.env.EXPO_PUBLIC_AI_API_KEY?.trim() ||
    process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim() ||
    '';
  const baseUrl = (
    process.env.EXPO_PUBLIC_AI_BASE_URL?.trim() ||
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const model = process.env.EXPO_PUBLIC_AI_MODEL?.trim() || 'gpt-4o-mini';
  return { apiKey, baseUrl, model };
}

export function isAiConfigured(): boolean {
  return Boolean(getAiConfig().apiKey);
}
