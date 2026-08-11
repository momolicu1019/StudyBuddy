import * as FileSystem from 'expo-file-system/legacy';

import type { DraftFlashcard } from '../api/types';
import { isAiConfigured } from './aiConfig';
import {
  cardCountInstruction,
  MAX_CARDS,
  targetCardCount,
  type CardCountTarget,
} from './cardCount';
import { estimatePdfPagesFromBase64 } from './contentExtract';
import {
  exampleFieldHint,
  exampleStyleInstruction,
  isSituationalMaterial,
} from './exampleStyle';
import {
  isWeakKeyPointTitle,
  normalizeKeyPointTitle,
  sanitizeFlashcardText,
  withExampleBullet,
} from './explanationFormat';
import { generateWithGemini } from './geminiClient';
import {
  labelForSource,
  mimeForSource,
  type SourceKind,
} from './sourceMime';

const MAX_INLINE_CHARS = 12_000_000;

export type StudyAnalysis = {
  overview: string;
  keyPoints: { title: string; summary: string }[];
};

export type PipelineResult = {
  overview: string;
  cards: DraftFlashcard[];
  usedAi: true;
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced?.[1] ?? trimmed).trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (Array.isArray(parsed)) {
      return { key_points: parsed };
    }
  } catch {
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(jsonText.slice(start, end + 1));
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
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

/**
 * Step 2→3: translate Gemini analysis / key points into review flashcards.
 */
export function translateAnalysisToFlashcards(
  analysis: StudyAnalysis,
  maxCards: number = MAX_CARDS,
): DraftFlashcard[] {
  const limit = Math.max(1, Math.min(MAX_CARDS, maxCards));
  const cards: DraftFlashcard[] = [];
  const seen = new Set<string>();

  for (const point of analysis.keyPoints) {
    const card = toReviewCard(point.title, point.summary);
    if (!card) continue;
    const key = `${card.question}::${card.answer}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(card);
    if (cards.length >= limit) break;
  }

  if (!cards.length && analysis.overview.trim().length >= 40) {
    const chunks = analysis.overview
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 40);
    chunks.slice(0, Math.min(12, limit)).forEach((chunk, i) => {
      const card = toReviewCard(`Key concept ${i + 1}`, chunk);
      if (card) cards.push(card);
    });
  }

  return cards.slice(0, limit);
}

function parseAnalysis(raw: string): StudyAnalysis {
  const obj = parseJsonObject(raw);
  if (!obj) {
    return { overview: raw.trim(), keyPoints: [] };
  }

  const overview = String(
    obj.overview ?? obj.summary ?? obj.analysis ?? obj.document_summary ?? '',
  ).trim();

  const listRaw =
    (Array.isArray(obj.key_points) && obj.key_points) ||
    (Array.isArray(obj.keyPoints) && obj.keyPoints) ||
    (Array.isArray(obj.points) && obj.points) ||
    (Array.isArray(obj.cards) && obj.cards) ||
    [];

  const keyPoints: StudyAnalysis['keyPoints'] = [];
  for (const item of listRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = String(
      row.title ??
        row.key_point ??
        row.topic ??
        row.heading ??
        row.concept ??
        row.front ??
        '',
    ).trim();
    const summary = withExampleBullet(buildExplanation(row), pickExample(row));
    if (!title || !summary) continue;
    keyPoints.push({ title, summary });
  }

  return { overview, keyPoints };
}

function buildAnalyzePrompt(args: {
  sourceLabel: string;
  filename?: string;
  fromExtractedText?: boolean;
  cardTarget: CardCountTarget;
  textSample?: string;
}): string {
  const countLine = cardCountInstruction(args.cardTarget);
  const situational = isSituationalMaterial([
    args.filename,
    args.sourceLabel,
    args.textSample,
  ]);
  const exampleRules = exampleStyleInstruction({
    filename: args.filename,
    sourceLabel: args.sourceLabel,
    situational,
  });
  return [
    'You are Study Buddy, an academic research tutor who writes informative study summaries.',
    args.fromExtractedText
      ? 'You are given OCR text copied word-for-word from a student photo. First summarize the important points from that exact text, then turn those points into exam-review flashcard material.'
      : `Read this ${args.sourceLabel} and extract the knowledge into exam-review flashcards.`,
    args.filename ? `Filename: ${args.filename}` : '',
    '',
    'Return ONLY valid JSON with this shape:',
    '{',
    '  "overview": "2-4 sentence scholarly overview of the subject matter (not the document layout)",',
    '  "key_points": [',
    '    {',
    '      "title": "short complete concept name (2-6 words)",',
    '      "explanation": "bullet list string (see rules)",',
    `      ${exampleFieldHint(situational)}`,
    '    }',
    '  ]',
    '}',
    '',
    'Title rules (critical):',
    '- title must be the MOST IMPORTANT concept name for that card (a noun phrase / term / process name).',
    situational
      ? '- Good examples: "Offer and Acceptance", "Duty of Care", "Miranda Rights", "Quiet Enjoyment".'
      : '- Good examples: "Water Cycle", "Photosynthesis", "Newton’s Second Law", "Mitochondria".',
    '- Bad examples: "The rain in", "Photosynthesis is the", "According to the notes", sentence fragments, or truncated phrases.',
    '- Never end a title with a preposition/article (in, of, the, a, and, to, for, with…).',
    '- Prefer 2 to 6 words. Do not write a full sentence as the title.',
    '',
    'Writing style for each explanation (critical):',
    '- ALWAYS write the explanation as a BULLET LIST — never one long paragraph.',
    '- Put each point on its own line starting with "• " (Unicode bullet + space).',
    '- Use 4 to 7 short bullets covering: what it is, how it works, key details, formulas/elements, and why it matters.',
    `- ${exampleRules}`,
    '- For very large sets (30+ cards), 4 focused bullets per card is enough (still include the Example bullet).',
    '- Keep each bullet to one clear idea (about 1 short sentence).',
    '- Do not start bullets with markdown like **, *, __, or #.',
    '- Include formulas, mechanisms, comparisons, cause/effect, elements/tests, and examples from the material when present.',
    '',
    'Hard bans — never do these:',
    '- Do NOT write a single paragraph wall of text.',
    '- Do NOT describe the page/photo layout (no “at the top of the page”, “on the left”, “the heading says”, “this slide shows”, “the image contains”).',
    '- Do NOT narrate OCR/visual structure, boxes, columns, or where text appears.',
    '- Do NOT invent facts that are not supported by the material.',
    '- Do NOT compress a long multi-page document into only ~12 cards when many distinct concepts are present.',
    '- Do NOT use science-lab style examples for law, ethics, or policy material.',
    args.fromExtractedText
      ? '- Stay faithful to the exact OCR wording for names, definitions, formulas, numbers, and quoted phrases. Summarize importance, but do not replace source wording with unrelated paraphrases when the original terms matter.'
      : '',
    '',
    'Other rules:',
    `- ${countLine}`,
    '- Titles must be concept names, not quiz questions (no What/Why/How/Define...).',
    situational
      ? '- Prefer doctrines, elements, tests, duties, rights, defenses, procedures, and leading rules.'
      : '- Prefer definitions, processes, formulas, comparisons, theorems, and must-know facts.',
    '- Plain text only — never use markdown (no **, __, `, or # headings).',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Step 1 (photo): copy ALL readable words from the image, word for word.
 */
async function extractExactTextFromPhoto(input: {
  base64: string;
  mimeType: string;
  filename?: string;
}): Promise<string> {
  const prompt = [
    'You are a strict OCR transcription engine for student study notes.',
    'Copy the text from this photo WORD FOR WORD — exact wording, spelling, punctuation, and order.',
    'Include headings, body text, captions, labels, formulas, equations, table cells, lists, and handwritten notes when readable.',
    'Preserve reading order with newlines between lines/sections.',
    'Do NOT summarize, paraphrase, correct, or explain anything.',
    'Do NOT add commentary such as “here is the text” or “the photo shows”.',
    'Return plain text only — no markdown, no JSON, no quotes around the whole result.',
    'If a word is partially unclear, give your best exact reading of the characters you see; do not skip whole sections.',
    input.filename ? `Filename hint: ${input.filename}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await generateWithGemini(
    [
      { text: prompt },
      { inlineData: { mimeType: input.mimeType, data: input.base64 } },
    ],
    { temperature: 0 },
  );

  return sanitizeFlashcardText(raw);
}

/**
 * Step 2 (photo): summarize the important points from the exact OCR text.
 */
async function summarizeExactPhotoText(input: {
  extractedText: string;
  filename?: string;
  cardTarget: CardCountTarget;
}): Promise<StudyAnalysis> {
  const analyzePrompt = buildAnalyzePrompt({
    sourceLabel: 'photo of student notes',
    filename: input.filename,
    fromExtractedText: true,
    cardTarget: input.cardTarget,
    textSample: input.extractedText.slice(0, 2000),
  });

  const analysisRaw = await generateWithGemini(
    [
      {
        text: [
          analyzePrompt,
          '',
          'Exact OCR text from the photo (word for word). Use this as the only source of truth:',
          '--- BEGIN EXACT TEXT ---',
          input.extractedText.slice(0, 14000),
          '--- END EXACT TEXT ---',
          '',
          'Now summarize the important points from that exact text and return the JSON.',
        ].join('\n'),
      },
    ],
    { temperature: 0.2, json: true },
  );

  if (!analysisRaw.trim()) {
    throw new Error('Gemini returned an empty summary of the photo text.');
  }

  return parseAnalysis(analysisRaw);
}

/**
 * Full Study Buddy generation flow:
 * 1) Upload study file (PDF, Word, PowerPoint, Excel, text, or photo)
 * 2) For photos: OCR exact words → summarize important points → flashcards
 *    For other files: submit to Gemini for analysis → flashcards
 * 3) Translate Gemini summary/key points into flashcards
 */
export async function generateFlashcardsViaGeminiPipeline(input: {
  uri: string;
  sourceType: SourceKind;
  filename?: string;
}): Promise<PipelineResult> {
  if (!isAiConfigured()) {
    throw new Error(
      'AI isn’t set up on this device yet. Please try again later.',
    );
  }

  const base64 = await FileSystem.readAsStringAsync(input.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!base64 || base64.length < 32) {
    throw new Error('Could not read the uploaded file.');
  }
  if (base64.length > MAX_INLINE_CHARS) {
    throw new Error(
      'File is too large for AI upload. Try a smaller file or a clearer cropped photo.',
    );
  }

  const mimeType = mimeForSource(input.sourceType, input.filename, input.uri);
  const sourceLabel = labelForSource(input.sourceType);
  // base64 length ≈ 4/3 of binary size
  const byteLength = Math.floor((base64.length * 3) / 4);

  let analysis: StudyAnalysis;
  let cardTarget: CardCountTarget;

  if (input.sourceType === 'photo') {
    // 1) Exact words from the photo
    const extracted = await extractExactTextFromPhoto({
      base64,
      mimeType,
      filename: input.filename,
    });

    if (extracted.replace(/\s+/g, ' ').trim().length < 40) {
      throw new Error(
        'Could not read enough text from the photo. Try a clearer, well-lit photo with readable writing.',
      );
    }

    cardTarget = targetCardCount({
      sourceType: 'photo',
      byteLength,
      textLength: extracted.length,
    });

    // 2) Summarize important points from that exact text
    analysis = await summarizeExactPhotoText({
      extractedText: extracted,
      filename: input.filename,
      cardTarget,
    });
  } else {
    const pageCount =
      input.sourceType === 'pdf'
        ? estimatePdfPagesFromBase64(base64)
        : undefined;

    cardTarget = targetCardCount({
      sourceType: input.sourceType,
      byteLength,
      pageCount,
    });

    const analyzePrompt = buildAnalyzePrompt({
      sourceLabel,
      filename: input.filename,
      cardTarget,
    });

    const analysisRaw = await generateWithGemini(
      [
        { text: analyzePrompt },
        { inlineData: { mimeType, data: base64 } },
      ],
      { temperature: 0.25, json: true },
    );

    if (!analysisRaw.trim()) {
      throw new Error('Gemini returned an empty analysis. Try another file.');
    }

    analysis = parseAnalysis(analysisRaw);
  }

  // 3) Generate flashcards from the summarized key points
  const cards = translateAnalysisToFlashcards(analysis, cardTarget.max);

  if (!cards.length) {
    throw new Error(
      'AI analyzed the file, but no key points could be turned into flashcards. Try another file or a clearer photo.',
    );
  }

  return {
    overview: analysis.overview,
    cards,
    usedAi: true,
  };
}
