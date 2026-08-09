import * as FileSystem from 'expo-file-system/legacy';

import type { DraftFlashcard } from '../api/types';
import { isAiConfigured } from './aiConfig';
import { formatExplanationAsBullets } from './explanationFormat';
import { generateAiText, generateWithGemini } from './geminiClient';
import {
  labelForSource,
  mimeForSource,
  type SourceKind,
} from './sourceMime';

const MAX_CARDS = 16;
const MIN_CARDS = 4;
const MAX_SOURCE_CHARS = 14000;
const MAX_INLINE_CHARS = 12_000_000; // ~9MB base64 budget guard

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
  const back = formatExplanationAsBullets(summary.trim());
  if (front.length < 2 || back.length < 40) return null;
  return { question: front, answer: back };
}

function buildExplanation(row: Record<string, unknown>): string {
  const parts = [
    row.explanation,
    row.summary,
    row.detail,
    row.details,
    row.notes,
    row.content,
    row.back,
    row.answer,
    row.why_it_matters,
    row.whyItMatters,
    row.example,
    row.formula,
  ]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);

  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.some((u) => u.toLowerCase() === part.toLowerCase())) {
      unique.push(part);
    }
  }
  return unique.join('\n\n').trim();
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

export function parseGeminiCards(raw: string): DraftFlashcard[] {
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
      row.title ??
        row.key_point ??
        row.topic ??
        row.concept ??
        row.front ??
        row.question ??
        '',
    );
    const summary = buildExplanation(row);
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

const FLASHCARD_INSTRUCTIONS = [
  'You are Study Buddy, an academic research tutor who writes informative study summaries.',
  'Create exam-review flashcards from the study material.',
  'Do NOT write quiz questions. Do NOT start titles with What/Why/How/Define.',
  'Each card: short concept title + a BULLETED explanation (never one long paragraph).',
  'Write explanation as 4 to 7 short lines, each starting with "• ", covering: what it is, how it works, key details, formulas/examples, and why it matters.',
  'Keep each bullet to one clear idea (about one short sentence).',
  'Include formulas, processes, comparisons, and examples when present in the source.',
  'Never describe page/photo layout (no “at the top”, “on the left”, “this slide shows”, “the heading says”, “the image contains”).',
  'Never narrate OCR/visual structure; convert the content into conceptual knowledge only.',
  'Do not invent facts not supported by the material.',
  'Return ONLY valid JSON as an array of objects with keys "title" and "explanation".',
  'Create 8 to 16 cards depending on how rich the material is.',
].join(' ');

/**
 * Ask Gemini to read the uploaded file directly (multimodal) and return review cards.
 */
export async function buildFlashcardsFromFile(input: {
  uri: string;
  sourceType: SourceKind;
  filename?: string;
}): Promise<{ cards: DraftFlashcard[]; usedAi: boolean; aiError?: string }> {
  if (!isAiConfigured()) {
    return { cards: [], usedAi: false, aiError: 'AI isn’t set up on this device yet.' };
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(input.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64 || base64.length < 32) {
      return { cards: [], usedAi: false, aiError: 'Could not read the uploaded file' };
    }
    if (base64.length > MAX_INLINE_CHARS) {
      return {
        cards: [],
        usedAi: false,
        aiError: 'File is too large for AI upload. Try a smaller file or photo.',
      };
    }

    const mimeType = mimeForSource(input.sourceType, input.filename, input.uri);
    const prompt = [
      FLASHCARD_INSTRUCTIONS,
      '',
      `Source type: ${labelForSource(input.sourceType)}.`,
      input.filename ? `Filename: ${input.filename}` : '',
      'Read the attached file carefully and produce the JSON flashcards now.',
    ]
      .filter(Boolean)
      .join('\n');

    const content = await generateWithGemini(
      [
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ],
      { temperature: 0.25, json: true },
    );

    const cards = parseGeminiCards(content);
    if (!cards.length) {
      return {
        cards: [],
        usedAi: true,
        aiError: 'AI returned no usable flashcards from this file',
      };
    }
    return { cards: cards.slice(0, MAX_CARDS), usedAi: true };
  } catch (error) {
    return {
      cards: [],
      usedAi: false,
      aiError: error instanceof Error ? error.message : 'AI file analysis failed',
    };
  }
}

async function buildFlashcardsWithAiText(
  text: string,
  options?: { filename?: string; sourceType?: SourceKind },
): Promise<DraftFlashcard[] | null> {
  if (!isAiConfigured()) return null;

  const sourceLabel = options?.sourceType
    ? labelForSource(options.sourceType)
    : 'study notes';
  const fileHint = options?.filename ? ` (file: ${options.filename})` : '';

  const content = await generateAiText({
    system: FLASHCARD_INSTRUCTIONS,
    user: [
      `Analyze these ${sourceLabel}${fileHint} and turn them into key-point review flashcards.`,
      '',
      'NOTES:',
      text.slice(0, MAX_SOURCE_CHARS),
    ].join('\n'),
    temperature: 0.3,
  });

  const cards = parseGeminiCards(content);
  return cards.length ? cards : null;
}

/**
 * Local fallback: key-point reviewer cards (not question-form).
 */
export function buildReviewFlashcardsLocally(
  rawText: string,
  options?: { filename?: string; sourceType?: SourceKind },
): DraftFlashcard[] {
  const text = cleanText(rawText);
  if (text.length < 20) {
    const label = options?.filename?.replace(/\.[^.]+$/, '') || 'your notes';
    return [
      {
        question: `Notes from ${label}`,
        answer:
          'Not enough readable content yet. Check your Gemini API key, restart Expo, and try generating again.',
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
 */
export async function buildFlashcardsFromText(
  rawText: string,
  options?: { filename?: string; sourceType?: SourceKind },
): Promise<{ cards: DraftFlashcard[]; usedAi: boolean; aiError?: string }> {
  const text = cleanText(rawText);
  if (text.length < 20) {
    return {
      cards: buildReviewFlashcardsLocally(text, options),
      usedAi: false,
    };
  }

  try {
    const aiCards = await buildFlashcardsWithAiText(text, options);
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

/**
 * Turn an AI Tutor reply into exam-review flashcards.
 */
export async function buildFlashcardsFromTutorReply(input: {
  reply: string;
  question?: string;
  subject?: string;
}): Promise<{ cards: DraftFlashcard[]; usedAi: boolean; aiError?: string }> {
  const reply = cleanText(input.reply);
  if (reply.length < 40) {
    return {
      cards: [],
      usedAi: false,
      aiError: 'That reply is too short to turn into flashcards.',
    };
  }

  if (!isAiConfigured()) {
    return {
      cards: buildReviewFlashcardsLocally(reply, {
        filename: input.subject || 'AI Tutor',
      }),
      usedAi: false,
    };
  }

  try {
    const content = await generateAiText({
      system: [
        'You are Study Buddy, an academic research tutor.',
        'Convert the tutor answer into exam-review flashcards.',
        'Do NOT write quiz questions. Titles must be concept names.',
        'Each card needs title + a BULLETED explanation (4–7 lines starting with "• "; never one paragraph).',
        'Do not mention chat, tutors, or that this came from an AI reply.',
        'Return ONLY valid JSON array with keys "title" and "explanation".',
        'Create 4 to 12 cards from the most important ideas in the answer.',
      ].join(' '),
      user: [
        input.subject ? `Subject focus: ${input.subject}` : '',
        input.question ? `Student question:\n${input.question}` : '',
        '',
        'Tutor answer to convert into flashcards:',
        reply.slice(0, MAX_SOURCE_CHARS),
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.3,
    });

    const cards = parseGeminiCards(content);
    if (cards.length) {
      return { cards: cards.slice(0, MAX_CARDS), usedAi: true };
    }
  } catch (error) {
    return {
      cards: buildReviewFlashcardsLocally(reply, {
        filename: input.subject || 'AI Tutor',
      }),
      usedAi: false,
      aiError: error instanceof Error ? error.message : 'AI request failed',
    };
  }

  return {
    cards: buildReviewFlashcardsLocally(reply, {
      filename: input.subject || 'AI Tutor',
    }),
    usedAi: false,
  };
}
