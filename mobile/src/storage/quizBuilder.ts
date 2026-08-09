import type { Flashcard, QuizQuestion } from '../api/types';

const FALLBACK_DISTRACTORS = [
  'Not enough information',
  'All of the above',
  'None of the above',
  'It depends on context',
  'This statement is false',
  'Cannot be determined from the notes',
];

const QUIZ_SIZE = 20;

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

/**
 * Build up to 20 random multiple-choice questions from subject flashcards.
 */
export function buildQuizQuestions(
  cards: Flashcard[],
  size: number = QUIZ_SIZE,
): QuizQuestion[] {
  if (!cards.length) return [];

  const selected = shuffle(cards).slice(0, Math.min(size, cards.length));
  const allAnswers = cards.map((c) => c.answer);

  return selected.map((card) => {
    const stem = card.question.trim().endsWith('?')
      ? card.question
      : `Key point: ${card.question}`;
    const { options, correct_index } = buildOptions(card.answer, allAnswers);
    return {
      id: card.id,
      question: stem,
      options,
      correct_index,
    };
  });
}

export { QUIZ_SIZE };
