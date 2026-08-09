import { getAiConfig, usesGemini } from './aiConfig';

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GenerateOptions = {
  temperature?: number;
  json?: boolean;
};

function geminiModelEndpoint(model: string, apiKey: string): string {
  // Prefer native Gemini endpoint (works with AI Studio / Gemini API keys).
  const cleanModel = model.replace(/^models\//, '');
  return `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
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

/**
 * Call Gemini generateContent (text and/or inline file parts).
 */
export async function generateWithGemini(
  parts: GeminiPart[],
  options?: GenerateOptions,
): Promise<string> {
  const { apiKey, model } = getAiConfig();
  if (!apiKey) {
    throw new Error('AI API key is not configured');
  }

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
      ...(options?.json
        ? { responseMimeType: 'application/json' }
        : {}),
    },
  };

  const response = await fetch(geminiModelEndpoint(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    throw new Error(`Gemini request failed (${response.status}): ${detail}`);
  }

  return extractGeminiText(json);
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

  // If someone still points at the Gemini OpenAI bridge, keep it working.
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
