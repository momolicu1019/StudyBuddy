import type { DraftFlashcard } from '../api/types';
import { isWeakKeyPointTitle, sanitizeFlashcardText } from './explanationFormat';

/**
 * Heuristic: flag AI cards that look incomplete, placeholder-like, or weak
 * so students can review them before saving.
 */
export function cardNeedsReview(card: DraftFlashcard): boolean {
  const question = sanitizeFlashcardText(card.question).trim();
  const answer = sanitizeFlashcardText(card.answer).trim();

  if (!question || !answer) return true;
  if (question.length < 3) return true;
  if (answer.length < 12) return true;
  if (isWeakKeyPointTitle(question)) return true;
  if (/^(key (point|concept)|concept|untitled|notes from)\b/i.test(question)) {
    return true;
  }
  if (/^(TODO|TBD|N\/A|none)\b/i.test(answer)) return true;
  if (/^example\s*[:\-–—]\s*$/i.test(answer)) return true;

  const answerWithoutBullets = answer.replace(/^[•\-]\s*/gm, '').trim();
  if (answerWithoutBullets.length < 12) return true;

  return false;
}

export function summarizeDraftQuality(cards: DraftFlashcard[]): {
  total: number;
  good: number;
  needsReview: number;
} {
  let needsReview = 0;
  for (const card of cards) {
    if (cardNeedsReview(card)) needsReview += 1;
  }
  const total = cards.length;
  return {
    total,
    good: Math.max(0, total - needsReview),
    needsReview,
  };
}
