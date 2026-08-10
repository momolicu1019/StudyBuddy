import * as FileSystem from 'expo-file-system/legacy';

import type { DraftFlashcard } from '../api/types';
import { isAiConfigured } from './aiConfig';
import {
  formatExplanationAsBullets,
  isWeakKeyPointTitle,
  normalizeKeyPointTitle,
  sanitizeFlashcardText,
} from './explanationFormat';
import { generateWithGemini } from './geminiClient';
import {
  labelForSource,
  mimeForSource,
  type SourceKind,
} from './sourceMime';

const MAX_CARDS = 16;
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

function toReviewCard(title: string, summary: string): DraftFlashcard | null {
  const back = formatExplanationAsBullets(summary);
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

/**
 * Step 2→3: translate Gemini analysis / key points into review flashcards.
 */
export function translateAnalysisToFlashcards(
  analysis: StudyAnalysis,
): DraftFlashcard[] {
  const cards: DraftFlashcard[] = [];
  const seen = new Set<string>();

  for (const point of analysis.keyPoints) {
    const card = toReviewCard(point.title, point.summary);
    if (!card) continue;
    const key = `${card.question}::${card.answer}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(card);
    if (cards.length >= MAX_CARDS) break;
  }

  if (!cards.length && analysis.overview.trim().length >= 40) {
    const chunks = analysis.overview
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 40);
    chunks.slice(0, 8).forEach((chunk, i) => {
      const card = toReviewCard(`Key concept ${i + 1}`, chunk);
      if (card) cards.push(card);
    });
  }

  return cards.slice(0, MAX_CARDS);
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
    const summary = buildExplanation(row);
    if (!title || !summary) continue;
    keyPoints.push({ title, summary });
  }

  return { overview, keyPoints };
}

function buildAnalyzePrompt(args: {
  sourceLabel: string;
  filename?: string;
  fromExtractedText?: boolean;
}): string {
  return [
    'You are Study Buddy, an academic research tutor who writes informative study summaries.',
    args.fromExtractedText
      ? 'Turn the extracted study-note text below into exam-review flashcards.'
      : `Read this ${args.sourceLabel} and extract the knowledge into exam-review flashcards.`,
    args.filename ? `Filename: ${args.filename}` : '',
    '',
    'Return ONLY valid JSON with this shape:',
    '{',
    '  "overview": "2-4 sentence scholarly overview of the subject matter (not the document layout)",',
    '  "key_points": [',
    '    {',
    '      "title": "short complete concept name (2-6 words)",',
    '      "explanation": "bullet list string (see rules)"',
    '    }',
    '  ]',
    '}',
    '',
    'Title rules (critical):',
    '- title must be the MOST IMPORTANT concept name for that card (a noun phrase / term / process name).',
    '- Good examples: "Water Cycle", "Photosynthesis", "Newton’s Second Law", "Mitochondria".',
    '- Bad examples: "The rain in", "Photosynthesis is the", "According to the notes", sentence fragments, or truncated phrases.',
    '- Never end a title with a preposition/article (in, of, the, a, and, to, for, with…).',
    '- Prefer 2 to 6 words. Do not write a full sentence as the title.',
    '',
    'Writing style for each explanation (critical):',
    '- ALWAYS write the explanation as a BULLET LIST — never one long paragraph.',
    '- Put each point on its own line starting with "• " (Unicode bullet + space).',
    '- Use 4 to 7 short bullets covering: what it is, how it works, key details, formulas/examples, and why it matters.',
    '- Keep each bullet to one clear idea (about 1 short sentence).',
    '- Do not start bullets with markdown like **, *, __, or #.',
    '- Include formulas, mechanisms, comparisons, cause/effect, and examples from the material when present.',
    '',
    'Hard bans — never do these:',
    '- Do NOT write a single paragraph wall of text.',
    '- Do NOT describe the page/photo layout (no “at the top of the page”, “on the left”, “the heading says”, “this slide shows”, “the image contains”).',
    '- Do NOT narrate OCR/visual structure, boxes, columns, or where text appears.',
    '- Do NOT invent facts that are not supported by the material.',
    '',
    'Other rules:',
    '- Create 8 to 16 key_points covering the most testable ideas from the full content.',
    '- Titles must be concept names, not quiz questions (no What/Why/How/Define...).',
    '- Prefer definitions, processes, formulas, comparisons, theorems, and must-know facts.',
    '- Plain text only — never use markdown (no **, __, `, or # headings).',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Photo flow: OCR all readable text first, then build flashcards from that text.
 */
async function extractTextFromPhoto(input: {
  base64: string;
  mimeType: string;
  filename?: string;
}): Promise<string> {
  const prompt = [
    'You are an OCR engine for student study notes.',
    'Extract ALL readable text from this photo.',
    'Include headings, body text, captions, labels, formulas, table cells, and handwritten notes when readable.',
    'Preserve reading order with newlines.',
    'Return plain text only — no commentary, no markdown, no “here is the text”.',
    'If some words are unclear, give your best reading; do not skip whole sections.',
    input.filename ? `Filename hint: ${input.filename}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await generateWithGemini(
    [
      { text: prompt },
      { inlineData: { mimeType: input.mimeType, data: input.base64 } },
    ],
    { temperature: 0.1 },
  );

  return sanitizeFlashcardText(raw);
}

/**
 * Full Study Buddy generation flow:
 * 1) Upload study file (PDF, Word, PowerPoint, Excel, text, or photo)
 * 2) Submit file to Gemini for analysis (photos: OCR text first)
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

  let analysisRaw = '';

  if (input.sourceType === 'photo') {
    const extracted = await extractTextFromPhoto({
      base64,
      mimeType,
      filename: input.filename,
    });

    if (extracted.replace(/\s+/g, ' ').trim().length < 40) {
      throw new Error(
        'Could not read enough text from the photo. Try a clearer, well-lit photo with readable writing.',
      );
    }

    const analyzePrompt = buildAnalyzePrompt({
      sourceLabel,
      filename: input.filename,
      fromExtractedText: true,
    });

    analysisRaw = await generateWithGemini(
      [
        {
          text: [
            analyzePrompt,
            '',
            'Extracted text from the photo (use ALL of this content):',
            extracted.slice(0, 14000),
          ].join('\n'),
        },
      ],
      { temperature: 0.25, json: true },
    );
  } else {
    const analyzePrompt = buildAnalyzePrompt({
      sourceLabel,
      filename: input.filename,
    });

    analysisRaw = await generateWithGemini(
      [
        { text: analyzePrompt },
        { inlineData: { mimeType, data: base64 } },
      ],
      { temperature: 0.25, json: true },
    );
  }

  if (!analysisRaw.trim()) {
    throw new Error('Gemini returned an empty analysis. Try another file.');
  }

  const analysis = parseAnalysis(analysisRaw);
  const cards = translateAnalysisToFlashcards(analysis);

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
