import type { Flashcard, QuizQuestion } from '../api/types';
import { isAiConfigured, usesGemini } from './aiConfig';
import { friendlyAiError, generateAiText, generateWithGemini } from './geminiClient';

const FALLBACK_DISTRACTORS = [
  'Not enough information',
  'All of the above',
  'None of the above',
  'It depends on context',
  'This statement is false',
  'Cannot be determined from the notes',
];

export const QUIZ_SIZE = 20;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function uniqueStrings(values: string[], except?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (except && key === except.trim().toLowerCase()) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function buildOptions(correctAnswer: string, poolAnswers: string[]): {
  options: string[];
  correct_index: number;
} {
  const distractors = uniqueStrings(
    [...shuffle(poolAnswers), ...FALLBACK_DISTRACTORS],
    correctAnswer,
  ).slice(0, 3);

  while (distractors.length < 3) {
    distractors.push(`Option ${String.fromCharCode(65 + distractors.length)}`);
  }

  const options = shuffle([correctAnswer, ...distractors]);
  return {
    options,
    correct_index: options.findIndex((o) => o === correctAnswer),
  };
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    const startObj = jsonText.indexOf('{');
    const endObj = jsonText.lastIndexOf('}');
    if (startObj >= 0 && endObj > startObj) {
      try {
        return JSON.parse(jsonText.slice(startObj, endObj + 1));
      } catch {
        // continue
      }
    }
    const startArr = jsonText.indexOf('[');
    const endArr = jsonText.lastIndexOf(']');
    if (startArr >= 0 && endArr > startArr) {
      try {
        return JSON.parse(jsonText.slice(startArr, endArr + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeCorrectIndex(
  row: Record<string, unknown>,
  options: string[],
): number {
  if (typeof row.correct_index === 'number' && Number.isFinite(row.correct_index)) {
    const idx = Math.round(row.correct_index);
    if (idx >= 0 && idx < options.length) return idx;
  }
  if (typeof row.correctIndex === 'number' && Number.isFinite(row.correctIndex)) {
    const idx = Math.round(row.correctIndex);
    if (idx >= 0 && idx < options.length) return idx;
  }

  const letter = String(row.answer ?? row.correct ?? row.correct_option ?? '')
    .trim()
    .toUpperCase();
  if (/^[A-D]$/.test(letter)) {
    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return idx;
  }

  const answerText = String(
    row.correct_answer ?? row.correctAnswer ?? row.answer_text ?? '',
  ).trim();
  if (answerText) {
    const idx = options.findIndex(
      (o) => o.toLowerCase() === answerText.toLowerCase(),
    );
    if (idx >= 0) return idx;
  }

  return 0;
}

export function parseGeminiQuizQuestions(
  raw: string,
  size: number = QUIZ_SIZE,
): QuizQuestion[] {
  const parsed = parseJsonPayload(raw);
  if (!parsed) return [];

  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { questions?: unknown }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];

  const questions: QuizQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const question = String(row.question ?? row.stem ?? row.prompt ?? '').trim();
    const optionsRaw = Array.isArray(row.options)
      ? row.options
      : Array.isArray(row.choices)
        ? row.choices
        : [];
    const options = optionsRaw
      .map((o) => String(o ?? '').trim())
      .filter(Boolean)
      .slice(0, 4);

    if (!question || options.length < 2) continue;

    while (options.length < 4) {
      options.push(`Option ${String.fromCharCode(65 + options.length)}`);
    }

    const correct_index = normalizeCorrectIndex(row, options);
    // Shuffle options while preserving correctness.
    const correctText = options[correct_index] ?? options[0];
    const shuffled = shuffle(options);
    const newCorrect = Math.max(
      0,
      shuffled.findIndex((o) => o === correctText),
    );

    questions.push({
      id: 10_000 + questions.length + 1,
      question,
      options: shuffled,
      correct_index: newCorrect,
    });

    if (questions.length >= size) break;
  }

  return questions;
}

/**
 * Local fallback: build MCQs from flashcards (used if Gemini is unavailable).
 */
export function buildQuizQuestions(
  cards: Flashcard[],
  size: number = QUIZ_SIZE,
): QuizQuestion[] {
  if (!cards.length) return [];

  const selected = shuffle(cards).slice(0, Math.min(size, cards.length));
  const allAnswers = cards.map((c) => c.answer);

  return selected.map((card, i) => {
    // Avoid “Key point: {title}” definition quizzes when possible.
    const stem = card.question.trim().endsWith('?')
      ? card.question
      : `Which statement best matches “${card.question}”?`;
    const { options, correct_index } = buildOptions(card.answer, allAnswers);
    return {
      id: 20_000 + i + 1,
      question: stem,
      options,
      correct_index,
    };
  });
}

function cardsToPromptBlock(cards: Flashcard[], limit = 40): string {
  return shuffle(cards)
    .slice(0, limit)
    .map((card, i) => {
      const title = card.question.trim().slice(0, 120);
      const explanation = card.answer.trim().slice(0, 500);
      return `${i + 1}. Concept: ${title}\n   Notes: ${explanation}`;
    })
    .join('\n\n');
}

/**
 * Ask Gemini to create up to 20 randomized MCQs from flashcard knowledge.
 * Questions should test understanding — not ask for the key-point definition.
 */
export async function buildQuizQuestionsViaGemini(
  cards: Flashcard[],
  size: number = QUIZ_SIZE,
): Promise<{ questions: QuizQuestion[]; usedAi: boolean; error?: string }> {
  if (!cards.length) {
    return { questions: [], usedAi: false, error: 'No flashcards available' };
  }

  if (!isAiConfigured()) {
    return {
      questions: buildQuizQuestions(cards, size),
      usedAi: false,
    };
  }

  const count = Math.min(size, Math.max(5, Math.min(20, cards.length * 2)));

  try {
    const system = [
      'You are Study Buddy, an exam writer.',
      'Create multiple-choice quiz questions from the student flashcard notes.',
      'Return ONLY valid JSON with this shape:',
      '{ "questions": [ { "question": string, "options": [string, string, string, string], "correct_index": number } ] }',
      'correct_index is 0-based (0..3).',
      'Rules:',
      '- Create exactly the requested number of questions when possible.',
      '- Randomize topics across the notes; do not go in flashcard order.',
      '- Do NOT ask “What is the definition of …” or “Define …” for the key-point title.',
      '- Do NOT use the key-point title alone as the question with its explanation as the obvious answer.',
      '- Prefer application, comparison, cause/effect, process steps, true implication, or scenario questions.',
      '- Each question must have exactly 4 plausible options and one clearly correct answer grounded in the notes.',
      '- Wrong options should be realistic misconceptions, not nonsense.',
      '- Keep questions concise and exam-like.',
    ].join(' ');
    const user = [
      `Create ${count} multiple-choice questions from these study notes:`,
      '',
      cardsToPromptBlock(cards),
    ].join('\n');

    const raw = usesGemini()
      ? await generateWithGemini([{ text: `${system}\n\n${user}` }], {
          temperature: 0.55,
          json: true,
        })
      : await generateAiText({
          system,
          user,
          temperature: 0.55,
        });

    const questions = parseGeminiQuizQuestions(raw, size);
    if (questions.length >= Math.min(5, count)) {
      return { questions: questions.slice(0, size), usedAi: true };
    }

    return {
      questions: buildQuizQuestions(cards, size),
      usedAi: false,
      error: 'AI returned too few quiz questions',
    };
  } catch (error) {
    return {
      questions: buildQuizQuestions(cards, size),
      usedAi: false,
      error: friendlyAiError(error),
    };
  }
}
