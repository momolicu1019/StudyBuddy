import { getAiConfig, usesGemini } from './aiConfig';

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GenerateOptions = {
  temperature?: number;
  json?: boolean;
};

/** Prefer configured model, then known working free-tier fallbacks. */
const FALLBACK_MODELS = [
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

function geminiModelEndpoint(model: string): string {
  const cleanModel = model.replace(/^models\//, '');
  return `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;
}

function extractGeminiText(payload: unknown): string {
  const data = payload as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (data.error?.message) {
    throw new Error(data.error.message);
  }
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
}

function shouldTryNextModel(status: number, detail: string): boolean {
  if (status === 404) return true;
  if (status !== 429) return false;
  return (
    /limit:\s*0/i.test(detail) ||
    /no longer available/i.test(detail) ||
    /deprecated/i.test(detail)
  );
}

function shortenGeminiError(status: number, detail: string): string {
  if (status === 429) {
    if (/limit:\s*0/i.test(detail) || /deprecated|no longer available/i.test(detail)) {
      return 'This Gemini model has no free-tier quota (often retired). Update EXPO_PUBLIC_AI_MODEL in mobile/.env (try gemini-flash-latest).';
    }
    return 'Gemini rate limit hit. Wait a moment and try again, or check https://ai.dev/rate-limit';
  }
  const firstLine = detail.split('\n')[0]?.trim() || detail;
  return firstLine.slice(0, 220);
}

async function generateWithGeminiModel(
  model: string,
  apiKey: string,
  parts: GeminiPart[],
  options?: GenerateOptions,
): Promise<string> {
  const body = {
    contents: [
      {
        role: 'user',
        parts: parts.map((part) =>
          'text' in part
            ? { text: part.text }
            : {
                inline_data: {
                  mime_type: part.inlineData.mimeType,
                  data: part.inlineData.data,
                },
              },
        ),
      },
    ],
    generationConfig: {
      temperature: options?.temperature ?? 0.3,
      ...(options?.json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const response = await fetch(geminiModelEndpoint(model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // keep raw
  }

  if (!response.ok) {
    const detail =
      (json as { error?: { message?: string } } | null)?.error?.message ||
      raw.slice(0, 220);
    const error = new Error(
      `Gemini request failed (${response.status}): ${shortenGeminiError(response.status, detail)}`,
    ) as Error & { status?: number; detail?: string; retryableModel?: boolean };
    error.status = response.status;
    error.detail = detail;
    error.retryableModel = shouldTryNextModel(response.status, detail);
    throw error;
  }

  return extractGeminiText(json);
}

/**
 * Call Gemini generateContent (text and/or inline file parts).
 * Retries alternate models when the configured one is retired / quota=0.
 */
export async function generateWithGemini(
  parts: GeminiPart[],
  options?: GenerateOptions,
): Promise<string> {
  const { apiKey, model } = getAiConfig();
  if (!apiKey) {
    throw new Error('AI API key is not configured');
  }

  const tried = new Set<string>();
  const queue = [model, ...FALLBACK_MODELS].filter((m) => {
    const id = m.replace(/^models\//, '');
    if (tried.has(id)) return false;
    tried.add(id);
    return true;
  });

  let lastError: Error | null = null;
  for (const candidate of queue) {
    try {
      return await generateWithGeminiModel(candidate, apiKey, parts, options);
    } catch (error) {
      const err = error as Error & { retryableModel?: boolean };
      lastError = err;
      if (!err.retryableModel) throw err;
    }
  }

  throw lastError ?? new Error('Gemini request failed');
}

/**
 * OpenAI-compatible chat completions (Groq / OpenAI / Gemini OpenAI bridge).
 */
export async function generateWithChatCompletions(input: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const { apiKey, baseUrl, model } = getAiConfig();
  if (!apiKey) throw new Error('AI API key is not configured');

  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: input.temperature ?? 0.4,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    }),
  });

  const raw = await response.text();
  let json: {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  } = {};
  try {
    json = JSON.parse(raw);
  } catch {
    // ignore
  }

  if (!response.ok) {
    throw new Error(
      `AI request failed (${response.status}): ${
        json.error?.message || raw.slice(0, 220)
      }`,
    );
  }

  return json.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Prefer native Gemini for Gemini keys/models; otherwise chat completions.
 */
export async function generateAiText(input: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  if (usesGemini()) {
    return generateWithGemini(
      [{ text: `${input.system}\n\n${input.user}` }],
      { temperature: input.temperature },
    );
  }
  return generateWithChatCompletions(input);
}
