import { type SourceKind } from './sourceMime';

/** Hard ceiling so Gemini responses stay parseable. */
export const MAX_CARDS = 60;
export const MIN_CARDS = 4;
export const MAX_CARDS_PHOTO = 14;

export type CardCountTarget = {
  min: number;
  max: number;
  suggested: number;
};

function clamp(n: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.round(n)));
}

function jitter(n: number, spread = 2): number {
  const delta = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
  return n + delta;
}

/**
 * Estimate how many flashcards the material warrants from size / text length.
 * Longer PDFs get many more cards than a single photo of notes.
 */
export function targetCardCount(input: {
  sourceType?: SourceKind;
  /** Raw file size in bytes (decoded, not base64). */
  byteLength?: number;
  /** Extracted / OCR text length when available. */
  textLength?: number;
  /** Known PDF page count when available. */
  pageCount?: number;
}): CardCountTarget {
  const sourceType = input.sourceType;
  const isPhoto = sourceType === 'photo';
  const textLen = Math.max(0, input.textLength ?? 0);
  const bytes = Math.max(0, input.byteLength ?? 0);
  const pageCount =
    input.pageCount && input.pageCount > 0 ? input.pageCount : undefined;

  if (isPhoto) {
    let suggested: number;
    if (textLen >= 40) {
      // ~1 card per ~350 chars of OCR, capped for a single page.
      suggested = clamp(textLen / 350, 5, MAX_CARDS_PHOTO);
    } else if (bytes < 200_000) {
      suggested = 7;
    } else if (bytes < 1_200_000) {
      suggested = 10;
    } else {
      suggested = 12;
    }
    suggested = clamp(jitter(suggested, 2), MIN_CARDS, MAX_CARDS_PHOTO);
    return {
      min: Math.max(MIN_CARDS, suggested - 3),
      max: Math.min(MAX_CARDS_PHOTO, suggested + 3),
      suggested,
    };
  }

  // Documents: prefer page count, then text length, else file-size estimate.
  let pages: number;
  if (pageCount) {
    pages = pageCount;
  } else if (textLen >= 80) {
    // ~500–700 chars of substance ≈ one reviewable concept on average.
    pages = Math.max(1, textLen / 550);
  } else if (bytes > 0) {
    pages = Math.max(1, bytes / 40_000);
  } else {
    pages = 8;
  }

  // Density jitter: sparse slides vs dense textbook pages.
  const density = 0.85 + Math.random() * 0.7;
  let suggested = clamp(pages * density, MIN_CARDS, MAX_CARDS);

  if (pages <= 2) suggested = Math.max(suggested, 6 + Math.floor(Math.random() * 5));
  else if (pages <= 6) suggested = Math.max(suggested, 8 + Math.floor(Math.random() * 7));

  suggested = clamp(jitter(suggested, 3), MIN_CARDS, MAX_CARDS);

  const min = clamp(suggested * 0.7, MIN_CARDS, suggested);
  const max = clamp(suggested * 1.25, suggested, MAX_CARDS);

  return { min, max, suggested };
}

/** Prompt line telling the model how many cards to create. */
export function cardCountInstruction(target: CardCountTarget): string {
  return [
    `Create about ${target.suggested} flashcards (acceptable range ${target.min}–${target.max}).`,
    'Scale with how much distinct testable information is present — short notes get fewer cards;',
    'long multi-page material needs many more so important sections are not collapsed into a tiny set.',
    'Prefer one card per distinct concept. Do not invent filler cards if the source is thin.',
  ].join(' ');
}
