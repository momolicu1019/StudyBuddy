/**
 * Split an explanation into short bullet lines for study UI.
 * Handles AI bullet lists, newlines, and plain paragraphs.
 */
export function explanationToBullets(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];

  const stripMarker = (line: string) =>
    line
      .replace(/^[-•*●▪◦–—]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^[A-Za-z]\)\s+/, '')
      .trim();

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
    .map((s) => s.trim())
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
