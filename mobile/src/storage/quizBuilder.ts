import type { Flashcard, QuizQuestion, QuizQuestionKind } from '../api/types';
import { isAiConfigured, usesGemini } from './aiConfig';
import { friendlyAiError, generateAiText, generateWithGemini } from './geminiClient';
import {
  kindsForQuizType,
  type QuizType,
} from './quizTypes';

const FALLBACK_DISTRACTORS = [
  'Not enough information',
  'All of the above',
  'None of the above',
  'It depends on context',
  'This statement is false',
  'Cannot be determined from the notes',
];

export const QUIZ_SIZE = 10;

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

function normalizeAnswerText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[•\-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose match for typed / fill-in answers. */
export function answersMatch(expected: string, given: string): boolean {
  const a = normalizeAnswerText(expected);
  const b = normalizeAnswerText(given);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) && b.length >= Math.min(4, a.length)) return true;
  if (b.includes(a) && a.length >= 3) return true;

  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (aTokens.length >= 2) {
    const overlap = aTokens.filter((t) => bTokens.has(t)).length;
    if (overlap / aTokens.length >= 0.7) return true;
  }
  return false;
}

function shortAnswerFromCard(card: Flashcard): string {
  const bullets = card.answer
    .split(/\n+/)
    .map((line) => line.replace(/^[•\-]\s*/, '').trim())
    .filter(Boolean);
  const first = bullets[0] ?? card.answer.trim();
  // Prefer a compact answer for typing / blanks.
  const sentence = first.split(/(?<=[.!?])\s+/)[0] ?? first;
  if (sentence.length <= 80) return sentence;
  return sentence.slice(0, 77).replace(/\s+\S*$/, '').trim();
}

function topicFromCard(card: Flashcard): string {
  const title = card.question.replace(/\?+$/g, '').trim();
  return title.length > 48 ? `${title.slice(0, 45).trim()}…` : title;
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

function kindFromRow(
  row: Record<string, unknown>,
  fallback: QuizQuestionKind | null,
): QuizQuestionKind | null {
  const hasExplicit = row.kind != null || row.type != null;
  const raw = String(hasExplicit ? (row.kind ?? row.type) : (fallback ?? ''))
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw) return fallback;
  if (
    raw === 'multiple_choice' ||
    raw === 'mcq' ||
    raw === 'multiplechoice'
  ) {
    return 'multiple_choice';
  }
  if (raw === 'typed_answer' || raw === 'typed' || raw === 'short_answer') {
    return 'typed_answer';
  }
  if (raw === 'true_false' || raw === 'truefalse' || raw === 'tf') {
    return 'true_false';
  }
  if (raw === 'fill_blank' || raw === 'fill_in_the_blank' || raw === 'blank') {
    return 'fill_blank';
  }
  return fallback;
}

export function parseGeminiQuizQuestions(
  raw: string,
  size: number = QUIZ_SIZE,
  defaultKind: QuizQuestionKind | null = 'multiple_choice',
  allowedKinds?: QuizQuestionKind[],
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

  const allowed =
    allowedKinds && allowedKinds.length
      ? new Set<QuizQuestionKind>(allowedKinds)
      : null;

  const questions: QuizQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const kind = kindFromRow(row, defaultKind);
    if (!kind) continue;
    if (allowed && !allowed.has(kind)) continue;
    const question = String(row.question ?? row.stem ?? row.prompt ?? '').trim();
    const topic = String(row.topic ?? row.concept ?? '').trim() || undefined;
    const correctText = String(
      row.correct_text ?? row.correct_answer ?? row.answer_text ?? '',
    ).trim();

    if (!question) continue;

    if (kind === 'typed_answer' || kind === 'fill_blank') {
      if (!correctText) continue;
      questions.push({
        id: 10_000 + questions.length + 1,
        kind,
        question,
        options: [],
        correct_index: 0,
        correct_text: correctText,
        topic,
      });
    } else if (kind === 'true_false') {
      const options = ['True', 'False'];
      let correct_index = normalizeCorrectIndex(row, options);
      const tf = String(row.correct_text ?? row.correct_answer ?? '')
        .trim()
        .toLowerCase();
      if (tf === 'true') correct_index = 0;
      if (tf === 'false') correct_index = 1;
      questions.push({
        id: 10_000 + questions.length + 1,
        kind: 'true_false',
        question,
        options,
        correct_index,
        correct_text: options[correct_index],
        topic,
      });
    } else {
      const optionsRaw = Array.isArray(row.options)
        ? row.options
        : Array.isArray(row.choices)
          ? row.choices
          : [];
      const options = optionsRaw
        .map((o) => String(o ?? '').trim())
        .filter(Boolean)
        .slice(0, 4);

      if (options.length < 2) continue;
      while (options.length < 4) {
        options.push(`Option ${String.fromCharCode(65 + options.length)}`);
      }

      const correct_index = normalizeCorrectIndex(row, options);
      const correctOption = options[correct_index] ?? options[0];
      const shuffled = shuffle(options);
      const newCorrect = Math.max(
        0,
        shuffled.findIndex((o) => o === correctOption),
      );

      questions.push({
        id: 10_000 + questions.length + 1,
        kind: 'multiple_choice',
        question,
        options: shuffled,
        correct_index: newCorrect,
        correct_text: shuffled[newCorrect],
        topic,
      });
    }

    if (questions.length >= size) break;
  }

  return questions;
}

function pickBlankWord(text: string): { blanked: string; answer: string } | null {
  const words = text
    .replace(/[•\-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter((w) => w.length >= 4 && !/^(this|that|with|from|have|been|were|they|their|about)$/i.test(w));
  if (!words.length) return null;
  const answer = words[Math.floor(Math.random() * words.length)];
  const blanked = text.replace(new RegExp(`\\b${answer}\\b`, 'i'), '_____');
  if (blanked === text) return null;
  return { blanked, answer };
}

function buildLocalQuestion(
  card: Flashcard,
  kind: QuizQuestionKind,
  allAnswers: string[],
  id: number,
): QuizQuestion {
  const topic = topicFromCard(card);
  const short = shortAnswerFromCard(card);

  if (kind === 'true_false') {
    const makeTrue = Math.random() > 0.45;
    if (makeTrue) {
      return {
        id,
        kind: 'true_false',
        question: `${card.question}: ${short}`,
        options: ['True', 'False'],
        correct_index: 0,
        correct_text: 'True',
        topic,
      };
    }
    const wrong = uniqueStrings(allAnswers, short)[0] ?? 'an unrelated idea';
    return {
      id,
      kind: 'true_false',
      question: `${card.question}: ${wrong}`,
      options: ['True', 'False'],
      correct_index: 1,
      correct_text: 'False',
      topic,
    };
  }

  if (kind === 'typed_answer') {
    return {
      id,
      kind: 'typed_answer',
      question: card.question.trim().endsWith('?')
        ? card.question
        : `In your own words, what is “${card.question}”?`,
      options: [],
      correct_index: 0,
      correct_text: short,
      topic,
    };
  }

  if (kind === 'fill_blank') {
    const blank = pickBlankWord(short) ?? pickBlankWord(card.answer);
    if (blank) {
      return {
        id,
        kind: 'fill_blank',
        question: `Fill in the blank about “${card.question}”:\n${blank.blanked}`,
        options: [],
        correct_index: 0,
        correct_text: blank.answer,
        topic,
      };
    }
    return {
      id,
      kind: 'fill_blank',
      question: `Fill in the blank: “${card.question}” is _____.`,
      options: [],
      correct_index: 0,
      correct_text: short.split(/\s+/).slice(0, 4).join(' ') || card.question,
      topic,
    };
  }

  const stem = card.question.trim().endsWith('?')
    ? card.question
    : `Which statement best matches “${card.question}”?`;
  const { options, correct_index } = buildOptions(card.answer, allAnswers);
  return {
    id,
    kind: 'multiple_choice',
    question: stem,
    options,
    correct_index,
    correct_text: options[correct_index],
    topic,
  };
}

/**
 * Local fallback: build quiz questions of the requested kinds from flashcards.
 */
export function buildQuizQuestions(
  cards: Flashcard[],
  size: number = QUIZ_SIZE,
  quizType: QuizType = 'multiple_choice',
): QuizQuestion[] {
  if (!cards.length) return [];

  const kinds = kindsForQuizType(quizType);
  const selected = shuffle(cards).slice(0, Math.min(size, cards.length));
  const allAnswers = cards.map((c) => c.answer);

  // For mixed quizzes, cycle kinds; otherwise reuse the single kind.
  return selected.map((card, i) => {
    const kind = kinds[i % kinds.length];
    return buildLocalQuestion(card, kind, allAnswers, 20_000 + i + 1);
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

function promptForQuizType(quizType: QuizType, count: number): string {
  const base = [
    'You are Study Buddy, an exam writer.',
    'Create quiz questions from the student flashcard notes.',
    'Return ONLY valid JSON with this shape:',
    '{ "questions": [ { "kind": string, "question": string, "options": string[] | null, "correct_index": number | null, "correct_text": string | null, "topic": string } ] }',
    'Rules:',
    `- Create exactly ${count} questions when possible.`,
    '- Randomize topics across the notes; do not go in flashcard order.',
    '- Do NOT ask “What is the definition of …” for the key-point title alone.',
    '- Prefer application, comparison, cause/effect, process steps, or scenario questions when the kind allows it.',
    '- Keep questions concise and exam-like.',
    '- topic should be a short concept name from the notes (for review lists).',
  ];

  switch (quizType) {
    case 'multiple_choice':
      return [
        ...base,
        'kind must be "multiple_choice" for every question.',
        'Each question needs exactly 4 options and correct_index 0-based (0..3).',
        'Wrong options should be realistic misconceptions.',
      ].join(' ');
    case 'typed_answer':
      return [
        ...base,
        'kind must be "typed_answer" for every question.',
        'options should be null/empty. Put the expected short answer in correct_text (a few words or one short sentence).',
      ].join(' ');
    case 'true_false':
      return [
        ...base,
        'kind must be "true_false" for every question.',
        'options must be ["True","False"]. correct_index is 0 for True or 1 for False.',
        'Mix true and false statements. False statements should be plausible but wrong.',
      ].join(' ');
    case 'fill_blank':
      return [
        ...base,
        'kind must be "fill_blank" for every question.',
        'Put a blank as _____ in the question. correct_text is the missing word or short phrase.',
        'options should be null/empty.',
      ].join(' ');
    case 'mixed':
      return [
        ...base,
        'Mix kinds across the set: multiple_choice, typed_answer, true_false, and fill_blank.',
        'Every question MUST include an explicit kind from that list.',
        'Include at least one question of each kind when the count allows.',
        'For multiple_choice: 4 options + correct_index.',
        'For true_false: options ["True","False"] + correct_index.',
        'For typed_answer and fill_blank: correct_text required; options empty.',
      ].join(' ');
  }
}

function localFallback(
  cards: Flashcard[],
  targetSize: number,
  quizType: QuizType,
  error?: string,
): { questions: QuizQuestion[]; usedAi: boolean; error?: string } {
  return {
    questions: buildQuizQuestions(cards, targetSize, quizType),
    usedAi: false,
    error,
  };
}

/**
 * AI-first quiz generation for every quiz type.
 * Sends the selected quiz type + flashcard notes to the model.
 * Only if AI is unavailable / fails / returns too few matching questions
 * do we fall back to building the quiz locally from analyzed cards.
 */
export async function buildQuizQuestionsViaGemini(
  cards: Flashcard[],
  size: number = QUIZ_SIZE,
  quizType: QuizType = 'multiple_choice',
): Promise<{ questions: QuizQuestion[]; usedAi: boolean; error?: string }> {
  if (!cards.length) {
    return { questions: [], usedAi: false, error: 'No flashcards available' };
  }

  const targetSize = Math.min(size, Math.max(1, cards.length * 2));
  const allowedKinds = kindsForQuizType(quizType);
  // Mixed quizzes must include an explicit kind per question; single-type
  // quizzes can default missing kind to the selected type.
  const defaultKind = quizType === 'mixed' ? null : allowedKinds[0];

  if (!isAiConfigured()) {
    return localFallback(
      cards,
      targetSize,
      quizType,
      'AI isn’t set up — built quiz from your flashcards',
    );
  }

  const count = Math.min(targetSize, Math.max(5, Math.min(20, cards.length * 2)));

  try {
    const system = promptForQuizType(quizType, count);
    const user = [
      `Create ${count} ${quizType.replace(/_/g, ' ')} questions from these study notes:`,
      `Quiz type: ${quizType}`,
      `Allowed question kinds: ${allowedKinds.join(', ')}`,
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

    const questions = parseGeminiQuizQuestions(
      raw,
      targetSize,
      defaultKind,
      allowedKinds,
    );
    if (questions.length >= Math.min(5, count, targetSize)) {
      return { questions: questions.slice(0, targetSize), usedAi: true };
    }

    return localFallback(
      cards,
      targetSize,
      quizType,
      'AI returned too few quiz questions — built quiz from your flashcards',
    );
  } catch (error) {
    return localFallback(
      cards,
      targetSize,
      quizType,
      `${friendlyAiError(error)} Built quiz from your flashcards.`,
    );
  }
}
