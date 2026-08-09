import * as FileSystem from 'expo-file-system/legacy';

import type { DraftFlashcard } from '../api/types';
import { isAiConfigured } from './aiConfig';
import { generateWithGemini } from './geminiClient';

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

function guessMime(
  sourceType: 'pdf' | 'photo',
  filename?: string,
  uri?: string,
): string {
  const name = `${filename ?? ''} ${uri ?? ''}`.toLowerCase();
  if (sourceType === 'pdf') return 'application/pdf';
  if (name.includes('.png')) return 'image/png';
  if (name.includes('.webp')) return 'image/webp';
  return 'image/jpeg';
}

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
  const front = title.trim().replace(/\?+$/g, '').trim();
  const back = summary.trim();
  if (front.length < 2 || back.length < 12) return null;
  if (/^(what|why|how|when|where|who|which)\b/i.test(front)) {
    return { question: front.replace(/\?+$/g, '').trim(), answer: back };
  }
  return { question: front, answer: back };
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

  // If Gemini only returned an overview, split it into a few review cards.
  if (!cards.length && analysis.overview.trim().length >= 40) {
    const chunks = analysis.overview
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 30);
    chunks.slice(0, 8).forEach((chunk, i) => {
      const card = toReviewCard(`Key point ${i + 1}`, chunk);
      if (card) cards.push(card);
    });
  }

  return cards.slice(0, MAX_CARDS);
}

function parseAnalysis(raw: string): StudyAnalysis {
  const obj = parseJsonObject(raw);
  if (!obj) {
    // Plain-text fallback: treat whole response as overview.
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
      row.title ?? row.key_point ?? row.topic ?? row.heading ?? row.front ?? '',
    ).trim();
    const summary = String(
      row.summary ?? row.detail ?? row.notes ?? row.content ?? row.back ?? '',
    ).trim();
    if (!title || !summary) continue;
    keyPoints.push({ title, summary });
  }

  return { overview, keyPoints };
}

/**
 * Full Study Buddy generation flow:
 * 1) Upload PDF/photo
 * 2) Submit file to Gemini for analysis
 * 3) Translate Gemini summary/key points into flashcards
 */
export async function generateFlashcardsViaGeminiPipeline(input: {
  uri: string;
  sourceType: 'pdf' | 'photo';
  filename?: string;
}): Promise<PipelineResult> {
  if (!isAiConfigured()) {
    throw new Error(
      'Gemini API key is missing. Add EXPO_PUBLIC_AI_API_KEY in mobile/.env and restart with npx expo start -c',
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
      'File is too large for Gemini upload. Try a smaller PDF or a clearer cropped photo.',
    );
  }

  const mimeType = guessMime(input.sourceType, input.filename, input.uri);
  const sourceLabel =
    input.sourceType === 'pdf' ? 'PDF document' : 'photo of student notes';

  const analyzePrompt = [
    'You are Study Buddy, an expert study coach.',
    `Analyze this ${sourceLabel} thoroughly.`,
    input.filename ? `Filename: ${input.filename}` : '',
    '',
    'Return ONLY valid JSON with this shape:',
    '{',
    '  "overview": "2-4 sentence overview of the whole material",',
    '  "key_points": [',
    '    { "title": "short key topic (NOT a question)", "summary": "1-3 sentence study summary" }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Create 8 to 16 key_points from the most important ideas.',
    '- Titles must NOT be quiz questions (no What/Why/How...).',
    '- Summaries should help a student review, using facts from the upload.',
    '- Prefer definitions, processes, formulas, comparisons, and must-know facts.',
  ]
    .filter(Boolean)
    .join('\n');

  // Step 2: submit upload to Gemini for analysis
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

  // Step 3: translate Gemini info into flashcards
  const analysis = parseAnalysis(analysisRaw);
  const cards = translateAnalysisToFlashcards(analysis);

  if (!cards.length) {
    throw new Error(
      'Gemini analyzed the file, but no key points could be turned into flashcards. Try a clearer PDF or photo.',
    );
  }

  return {
    overview: analysis.overview,
    cards,
    usedAi: true,
  };
}
