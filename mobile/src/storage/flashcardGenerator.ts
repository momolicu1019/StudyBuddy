import type { DraftFlashcard } from '../api/types';
import { getAiConfig, isAiConfigured } from './aiConfig';

const MAX_CARDS = 16;
const MIN_CARDS = 4;
const MAX_SOURCE_CHARS = 14000;

function cleanText(raw: string): string {
  return raw
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return (
    t.endsWith('?') ||
    /^(what|why|how|when|where|who|which|explain|describe|define|fill in)\b/i.test(
      t,
    )
  );
}

function toReviewCard(title: string, summary: string): DraftFlashcard | null {
  const front = title.trim().replace(/\?+$/g, '').trim();
  const back = summary.trim();
  if (front.length < 2 || back.length < 12) return null;
  // Keep storage fields, but content is key-point + summary (not Q&A).
  return { question: front, answer: back };
}

function uniqueCards(cards: DraftFlashcard[]): DraftFlashcard[] {
  const seen = new Set<string>();
  const out: DraftFlashcard[] = [];
  for (const card of cards) {
    const key = `${card.question}::${card.answer}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

function parseGeminiCards(raw: string): DraftFlashcard[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced?.[1] ?? trimmed).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const start = jsonText.indexOf('[');
    const end = jsonText.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
      parsed = JSON.parse(jsonText.slice(start, end + 1));
    } catch {
      return [];
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { cards?: unknown }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : [];

  const cards: DraftFlashcard[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = String(
      row.title ?? row.key_point ?? row.topic ?? row.front ?? row.question ?? '',
    );
    const summary = String(
      row.summary ?? row.detail ?? row.notes ?? row.back ?? row.answer ?? '',
    );
    const card = toReviewCard(title, summary);
    if (!card) continue;
    if (looksLikeQuestion(card.question)) {
      card.question = card.question.replace(/\?+$/g, '').trim();
    }
    cards.push(card);
    if (cards.length >= MAX_CARDS) break;
  }
  return uniqueCards(cards);
}

async function buildFlashcardsWithGemini(
  text: string,
  options?: { filename?: string; sourceType?: 'pdf' | 'photo' },
): Promise<DraftFlashcard[] | null> {
  if (!isAiConfigured()) return null;

  const { apiKey, baseUrl, model } = getAiConfig();
  const sourceLabel =
    options?.sourceType === 'photo' ? 'photo notes' : 'PDF notes';
  const fileHint = options?.filename ? ` (file: ${options.filename})` : '';

  const system = [
    'You are Study Buddy, an expert study coach.',
    'Convert student notes into revision flashcards that highlight key points.',
    'Do NOT write quiz questions. Do NOT start titles with What/Why/How.',
    'Each card is a reviewer note: a short key-point title + a clear summary.',
    'Return ONLY valid JSON (no markdown) as an array of objects with keys "title" and "summary".',
    'Create 8 to 16 cards depending on how rich the notes are.',
    'Summaries should be 1 to 3 concise sentences, accurate to the source.',
    'Prefer definitions, processes, formulas, comparisons, and must-know facts.',
  ].join(' ');

  const user = [
    `Analyze these ${sourceLabel}${fileHint} and turn them into key-point review flashcards.`,
    '',
    'NOTES:',
    text.slice(0, MAX_SOURCE_CHARS),
  ].join('\n');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Gemini flashcard request failed (${response.status})${
        detail ? `: ${detail.slice(0, 160)}` : ''
      }`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  const cards = parseGeminiCards(content);
  return cards.length >= MIN_CARDS ? cards : cards.length ? cards : null;
}

/**
 * Local fallback: key-point reviewer cards (not question-form).
 */
export function buildReviewFlashcardsLocally(
  rawText: string,
  options?: { filename?: string; sourceType?: 'pdf' | 'photo' },
): DraftFlashcard[] {
  const text = cleanText(rawText);
  if (text.length < 20) {
    const label = options?.filename?.replace(/\.[^.]+$/, '') || 'your notes';
    return [
      {
        question: `Notes from ${label}`,
        answer:
          'Not enough readable text was extracted. Try a clearer photo or a text-based PDF, then generate again.',
      },
    ];
  }

  const cards: DraftFlashcard[] = [];

  const defPatterns = [
    /([A-Z][A-Za-z0-9 _/-]{2,40})\s+(?:is|are|means|refers to)\s+(.+?)(?:[.!]|$)/g,
    /([A-Z][A-Za-z0-9 _/-]{2,40})\s*[:–-]\s*(.+?)(?:[.!\n]|$)/g,
  ];
  for (const pattern of defPatterns) {
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(text)) !== null) {
      const card = toReviewCard(match[1], match[2]);
      if (card) cards.push(card);
      if (cards.length >= MAX_CARDS) return uniqueCards(cards);
    }
  }

  const bullets = text
    .split('\n')
    .map((line) => line.replace(/^[\s•\-–—*·\d.)]+\s*/, '').trim())
    .filter((line) => line.length >= 25 && line.length <= 240);

  for (const bullet of bullets) {
    if (cards.length >= MAX_CARDS) break;
    if (/^.+:\s+.+$/.test(bullet)) {
      const [left, ...rest] = bullet.split(':');
      const card = toReviewCard(left, rest.join(':'));
      if (card) cards.push(card);
      continue;
    }
    const words = bullet.split(/\s+/);
    const title = words.slice(0, Math.min(8, words.length)).join(' ');
    const card = toReviewCard(title, bullet);
    if (card) cards.push(card);
  }

  if (cards.length < MIN_CARDS) {
    const chunks = text.match(/[\s\S]{90,220}/g) ?? [text.slice(0, 220)];
    chunks.forEach((chunk, i) => {
      if (cards.length >= MAX_CARDS) return;
      const snippet = chunk.trim().replace(/\s+/g, ' ');
      const card = toReviewCard(`Key point ${i + 1}`, snippet);
      if (card) cards.push(card);
    });
  }

  return uniqueCards(cards).slice(0, MAX_CARDS);
}

/**
 * Build reviewer flashcards from extracted note text.
 * Uses Gemini when configured; falls back to local key-point extraction.
 */
export async function buildFlashcardsFromText(
  rawText: string,
  options?: { filename?: string; sourceType?: 'pdf' | 'photo' },
): Promise<{ cards: DraftFlashcard[]; usedAi: boolean; aiError?: string }> {
  const text = cleanText(rawText);
  if (text.length < 20) {
    return {
      cards: buildReviewFlashcardsLocally(text, options),
      usedAi: false,
    };
  }

  try {
    const aiCards = await buildFlashcardsWithGemini(text, options);
    if (aiCards?.length) {
      return { cards: aiCards.slice(0, MAX_CARDS), usedAi: true };
    }
  } catch (error) {
    const aiError = error instanceof Error ? error.message : 'AI request failed';
    return {
      cards: buildReviewFlashcardsLocally(text, options),
      usedAi: false,
      aiError,
    };
  }

  return {
    cards: buildReviewFlashcardsLocally(text, options),
    usedAi: false,
  };
}
