import * as FileSystem from 'expo-file-system/legacy';

import type { DraftFlashcard } from '../api/types';
import { isAiConfigured } from './aiConfig';
import {
  cardCountInstruction,
  MAX_CARDS,
  MIN_CARDS,
  targetCardCount,
} from './cardCount';
import { estimatePdfPagesFromBase64 } from './contentExtract';
import { formatExplanationAsBullets, isWeakKeyPointTitle, normalizeKeyPointTitle, withExampleBullet } from './explanationFormat';
import { generateAiText, generateWithGemini } from './geminiClient';
import {
  labelForSource,
  mimeForSource,
  type SourceKind,
} from './sourceMime';

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

function toReviewCard(
  title: string,
  summary: string,
  example?: string,
): DraftFlashcard | null {
  const back = withExampleBullet(summary, example);
  if (back.length < 40) return null;
  const front = normalizeKeyPointTitle(title, back);
  if (front.length < 2 || isWeakKeyPointTitle(front)) return null;
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

function pickExample(row: Record<string, unknown>): string {
  return String(row.example ?? row.example_text ?? row.worked_example ?? '').trim();
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

const META_CARD_NOISE =
  /since you (don'?t|do not) have|couldn'?t find matching|generate flashcards|make flashcards|ai isn'?t available|try asking again|from your flashcards first|tip:\s*generate/i;

function isStudyContentCard(card: DraftFlashcard): boolean {
  const blob = `${card.question}\n${card.answer}`;
  return !META_CARD_NOISE.test(blob);
}

export function parseGeminiCards(
  raw: string,
  maxCards: number = MAX_CARDS,
): DraftFlashcard[] {
  const limit = Math.max(1, Math.min(MAX_CARDS, maxCards));
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
    const card = toReviewCard(title, summary, pickExample(row));
    if (!card) continue;
    if (looksLikeQuestion(card.question)) {
      card.question = card.question.replace(/\?+$/g, '').trim();
    }
    cards.push(card);
    if (cards.length >= limit) break;
  }
  return uniqueCards(cards);
}

function flashcardInstructions(maxHint?: string): string {
  return [
    'You are Study Buddy, an academic research tutor who writes informative study summaries.',
    'Create exam-review flashcards from the study material.',
    'Do NOT write quiz questions. Do NOT start titles with What/Why/How/Define.',
    'Each card: short concept title + a BULLETED explanation (never one long paragraph).',
    'Title must be the MOST IMPORTANT concept name (2–6 words), e.g. "Water Cycle" or "Photosynthesis".',
    'Never use truncated sentence starters as titles (bad: "The rain in", "Photosynthesis is the").',
    'Never end a title with a preposition/article (in, of, the, a, and, to, for, with…).',
    'Write explanation as 4 to 7 short lines, each starting with "• ", covering: what it is, how it works, key details, formulas, and why it matters.',
    'ALWAYS include one bullet that starts with "Example: " with a concrete case, mini worked problem, or real-world application.',
    'Keep each bullet to one clear idea (about one short sentence).',
    'Do not start bullets with markdown like **, *, __, or #.',
    'Include formulas, processes, comparisons, and examples when present in the source.',
    'Never describe page/photo layout (no “at the top”, “on the left”, “this slide shows”, “the heading says”, “the image contains”).',
    'Never narrate OCR/visual structure; convert the content into conceptual knowledge only.',
    'Do not invent facts not supported by the material.',
    'Never use markdown formatting (no **, __, `, # headings, or code fences). Plain text only.',
    'Return ONLY valid JSON as an array of objects with keys "title", "explanation", and optional "example".',
    maxHint ??
      'Create as many cards as the material needs (typically 6–12 for a short page, up to 60 for long PDFs). Do not collapse rich multi-page notes into only ~12 cards.',
  ].join(' ');
}

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
    const cardTarget = targetCardCount({
      sourceType: input.sourceType,
      byteLength: Math.floor((base64.length * 3) / 4),
      pageCount:
        input.sourceType === 'pdf'
          ? estimatePdfPagesFromBase64(base64)
          : undefined,
    });
    const prompt = [
      flashcardInstructions(cardCountInstruction(cardTarget)),
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

    const cards = parseGeminiCards(content, cardTarget.max);
    if (!cards.length) {
      return {
        cards: [],
        usedAi: true,
        aiError: 'AI returned no usable flashcards from this file',
      };
    }
    return { cards: cards.slice(0, cardTarget.max), usedAi: true };
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
  const cardTarget = targetCardCount({
    sourceType: options?.sourceType,
    textLength: text.length,
  });

  const content = await generateAiText({
    system: flashcardInstructions(cardCountInstruction(cardTarget)),
    user: [
      `Analyze these ${sourceLabel}${fileHint} and turn them into key-point review flashcards.`,
      '',
      'NOTES:',
      text.slice(0, MAX_SOURCE_CHARS),
    ].join('\n'),
    temperature: 0.3,
  });

  const cards = parseGeminiCards(content, cardTarget.max);
  return cards.length ? cards.slice(0, cardTarget.max) : null;
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

  const cardTarget = targetCardCount({
    sourceType: options?.sourceType,
    textLength: text.length,
  });
  const limit = cardTarget.max;
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
      if (cards.length >= limit) return uniqueCards(cards);
    }
  }

  const bullets = text
    .split('\n')
    .map((line) => line.replace(/^[\s•\-–—*·\d.)]+\s*/, '').trim())
    .filter((line) => line.length >= 25 && line.length <= 240);

  for (const bullet of bullets) {
    if (cards.length >= limit) break;
    if (/^.+:\s+.+$/.test(bullet)) {
      const [left, ...rest] = bullet.split(':');
      const card = toReviewCard(left, rest.join(':'));
      if (card) cards.push(card);
      continue;
    }
    // Prefer a definition-style title over chopping the first N words of a sentence.
    const defMatch = bullet.match(
      /^(.{2,55}?)\s+(?:is|are|means|refers to)\b/i,
    );
    const title = defMatch?.[1]?.trim() || `Key idea`;
    const card = toReviewCard(title, bullet);
    if (card) cards.push(card);
  }

  if (cards.length < MIN_CARDS) {
    const chunks = text.match(/[\s\S]{90,220}/g) ?? [text.slice(0, 220)];
    chunks.forEach((chunk, i) => {
      if (cards.length >= limit) return;
      const snippet = chunk.trim().replace(/\s+/g, ' ');
      const card = toReviewCard(`Key point ${i + 1}`, snippet);
      if (card) cards.push(card);
    });
  }

  return uniqueCards(cards).slice(0, limit);
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
      return { cards: aiCards, usedAi: true };
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
 * Remove tutor meta / coaching wrappers so flashcards only use study content.
 */
export function stripTutorReplyForFlashcards(reply: string): string {
  let text = cleanText(reply);

  // Drop common openers about missing cards / app status.
  text = text.replace(
    /^(since you (don'?t|do not) have[^.!?\n]*[.!?]\s*)+/i,
    '',
  );
  text = text.replace(
    /^(i couldn'?t find matching (flashcards|notes)[^.!?\n]*[.!?]\s*)+/i,
    '',
  );
  text = text.replace(
    /^(here'?s a direct answer based on your[^.!?\n]*[.!:]\s*)+/i,
    '',
  );

  // Drop “You asked: …” meta when it appears as a short lead-in.
  text = text.replace(/^you asked:\s*[“"][^”"]+[”"]\s*/i, '');

  // Drop footers / tips about the app.
  text = text.replace(/\n+tip:\s*[\s\S]*$/i, '');
  text = text.replace(
    /\n+if you want,? ask a follow-up[\s\S]*$/i,
    '',
  );
  text = text.replace(
    /\n+that comes from your card:\s*[“"][^”"]+[”"]\s*$/i,
    '',
  );
  text = text.replace(
    /\n+(generate flashcards from your notes first[\s\S]*)$/i,
    '',
  );
  text = text.replace(
    /\n+(you can try asking again[\s\S]*)$/i,
    '',
  );

  // Drop note/source vs general-knowledge asides that aren't exam content.
  text = text.replace(
    /\n*\(?\s*(from (your )?notes|general knowledge|no matching flashcards)[^.!?\n]*[.!?]?\s*\)?/gi,
    '',
  );

  return cleanText(text);
}

/**
 * Turn an AI Tutor reply into exam-review flashcards.
 */
export async function buildFlashcardsFromTutorReply(input: {
  reply: string;
  question?: string;
  subject?: string;
}): Promise<{ cards: DraftFlashcard[]; usedAi: boolean; aiError?: string }> {
  const reply = stripTutorReplyForFlashcards(input.reply);
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
    const tutorTarget = targetCardCount({ textLength: reply.length });
    const tutorLimit = Math.min(tutorTarget.max, 16);
    const content = await generateAiText({
      system: [
        'You are Study Buddy, an academic research tutor.',
        'Convert the tutor answer into exam-review flashcards.',
        'Do NOT write quiz questions. Titles must be concept names.',
        'Each card needs title + a BULLETED explanation (4–7 lines starting with "• "; never one paragraph).',
        'ALWAYS include one bullet that starts with "Example: " giving a concrete case or mini application.',
        'Title must be the most important concept name (2–6 words), never a truncated sentence starter.',
        'Use ONLY the academic content. Ignore any meta about missing flashcards, AI errors, tips, or app features.',
        'Do not mention chat, tutors, or that this came from an AI reply.',
        'Plain text only — never use markdown (no **, __, `, or # headings).',
        'Return ONLY valid JSON array with keys "title", "explanation", and optional "example".',
        cardCountInstruction({
          ...tutorTarget,
          max: tutorLimit,
          suggested: Math.min(tutorTarget.suggested, tutorLimit),
        }),
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

    const cards = parseGeminiCards(content, tutorLimit).filter(isStudyContentCard);
    if (cards.length) {
      return { cards, usedAi: true };
    }
  } catch (error) {
    return {
      cards: buildReviewFlashcardsLocally(reply, {
        filename: input.subject || 'AI Tutor',
      }).filter(isStudyContentCard),
      usedAi: false,
      aiError: error instanceof Error ? error.message : 'AI request failed',
    };
  }

  return {
    cards: buildReviewFlashcardsLocally(reply, {
      filename: input.subject || 'AI Tutor',
    }).filter(isStudyContentCard),
    usedAi: false,
  };
}
