/**
 * Strip markdown / decorative markup so flashcards stay plain and readable.
 * Keeps letters, numbers, punctuation, and simple bullets.
 */
export function sanitizeFlashcardText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    // Paired markdown emphasis / code
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    // Headings, links, images
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Leftover emphasis markers and fences
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/~~/g, '')
    .replace(/`{1,3}/g, '')
    .replace(/^>{1,3}\s?/gm, '')
    // Zero-width / odd control chars
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Collapse messy spaces (preserve newlines)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split an explanation into short bullet lines for study UI.
 * Handles AI bullet lists, newlines, and plain paragraphs.
 */
export function explanationToBullets(text: string): string[] {
  const raw = sanitizeFlashcardText(text);
  if (!raw) return [];

  const stripMarker = (line: string) =>
    sanitizeFlashcardText(
      line
        .replace(/^[-•*●▪◦–—]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^[A-Za-z]\)\s+/, ''),
    );

  const byLine = raw
    .split(/\n+/)
    .map(stripMarker)
    .filter(Boolean);

  if (byLine.length >= 2) return byLine;

  const midBullets = raw
    .split(/\s*[•●▪◦]\s+/)
    .map(stripMarker)
    .filter(Boolean);
  if (midBullets.length >= 2) return midBullets;

  // Plain paragraph → one bullet per sentence so existing cards stay readable.
  const sentences = raw
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((s) => sanitizeFlashcardText(s))
    .filter((s) => s.length > 12);

  if (sentences.length >= 2) return sentences;

  return [raw];
}

/** Normalize stored explanation text into a consistent • bullet list. */
export function formatExplanationAsBullets(text: string): string {
  return explanationToBullets(text)
    .map((line) => `• ${line}`)
    .join('\n');
}
