/**
 * Strip markdown / decorative markup so flashcards stay plain and readable.
 * Keeps letters, numbers, punctuation, and simple bullets.
 */
export function sanitizeFlashcardText(text: string): string {
  return sanitizeStudyText(text);
}

/**
 * Convert common LaTeX / math markup into plain readable text for students.
 */
export function sanitizeLatex(text: string): string {
  let out = text.replace(/\r/g, '\n');

  // Display / inline math fences → keep inner content
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => inner.trim());
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner: string) => inner.trim());
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner: string) => inner.trim());
  out = out.replace(/\$([^$\n]+?)\$/g, (_, inner: string) => inner.trim());

  // Nested text wrappers
  for (let i = 0; i < 4; i += 1) {
    const next = out
      .replace(/\\(?:text|mathrm|mathbf|mathit|textrm|textsf|textbf|textit|operatorname)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\(?:left|right)\s*/g, '')
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/\\sqrt\s*/g, '√')
      .replace(/_\{([^{}]*)\}/g, '_$1')
      .replace(/\^\{([^{}]*)\}/g, '^$1');
    if (next === out) break;
    out = next;
  }

  const symbolMap: Record<string, string> = {
    times: '×',
    cdot: '·',
    div: '÷',
    pm: '±',
    mp: '∓',
    leq: '≤',
    le: '≤',
    geq: '≥',
    ge: '≥',
    neq: '≠',
    ne: '≠',
    approx: '≈',
    sim: '~',
    infty: '∞',
    dots: '…',
    ldots: '…',
    cdots: '…',
    vdots: '…',
    to: '→',
    rightarrow: '→',
    leftarrow: '←',
    Rightarrow: '⇒',
    Leftarrow: '⇐',
    iff: '⇔',
    subset: '⊂',
    subseteq: '⊆',
    superset: '⊃',
    superseteq: '⊇',
    in: '∈',
    notin: '∉',
    cup: '∪',
    cap: '∩',
    emptyset: '∅',
    degree: '°',
    circ: '°',
    angstrom: 'Å',
    ohm: 'Ω',
    Omega: 'Ω',
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    Delta: 'Δ',
    epsilon: 'ε',
    theta: 'θ',
    Theta: 'Θ',
    lambda: 'λ',
    mu: 'μ',
    pi: 'π',
    Pi: 'Π',
    sigma: 'σ',
    Sigma: 'Σ',
    phi: 'φ',
    omega: 'ω',
    sum: 'Σ',
    prod: 'Π',
    int: '∫',
  };

  out = out.replace(/\\([A-Za-z]+)\b/g, (_, name: string) => {
    return symbolMap[name] ?? '';
  });

  // Escape leftovers and spacing commands
  out = out
    .replace(/\\[{}]/g, (m) => m.slice(1))
    .replace(/\\[,;:!]/g, ' ')
    .replace(/\\quad\b/g, ' ')
    .replace(/\\qquad\b/g, ' ')
    .replace(/\\\\/g, '\n')
    .replace(/\\/g, '');

  return out;
}

/**
 * Plain-text cleanup for tutor replies and flashcard content:
 * removes markdown emphasis and converts LaTeX into readable symbols.
 */
export function sanitizeStudyText(text: string): string {
  let out = sanitizeLatex(String(text ?? ''));

  out = out
    // Paired markdown emphasis / code (avoid touching math-like identifiers such as V_total)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*([\s).,!?:;]|$)/g, '$1$2$3')
    .replace(/(^|[\s(])_([^_\n]+)_([\s).,!?:;]|$)/g, '$1$2$3')
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

  return out;
}

/** Strip leftover markup that often appears at the start of a bullet/line. */
export function stripLeadingFlashcardJunk(text: string): string {
  let line = text.trim();
  for (let i = 0; i < 4; i += 1) {
    const next = line
      .replace(/^[\s*_#`~•●▪◦\-–—>★☆▪︎·]+/, '')
      .replace(/^\*{1,3}/, '')
      .replace(/^_{1,3}/, '')
      .replace(/^:+\s*/, '')
      .replace(/^["'“”‘’]+/, '')
      .trim();
    if (next === line) break;
    line = next;
  }
  return sanitizeFlashcardText(line);
}

const WEAK_TITLE_ENDINGS =
  /\b(the|a|an|and|or|of|in|on|to|for|with|from|by|as|at|into|onto|about|over|under|than|then|that|this|these|those|is|are|was|were|be|been|being)\s*$/i;

/**
 * True when a key-point title looks like a truncated sentence, not a concept name.
 * Example: "The rain in" / "Photosynthesis is the process of..."
 */
export function isWeakKeyPointTitle(title: string): boolean {
  const t = sanitizeFlashcardText(title).replace(/\?+$/g, '').trim();
  if (t.length < 3) return true;
  if (t.length > 64) return true;
  if (/[.…]{2,}|…$|\.\.\.$/.test(t)) return true;
  if (/,$/.test(t)) return true;
  if (WEAK_TITLE_ENDINGS.test(t)) return true;
  if (/^(key (point|concept)|concept|notes from|untitled)\b/i.test(t)) return true;
  if (/^(what|why|how|when|where|who|which|explain|describe|define)\b/i.test(t)) {
    return true;
  }

  const words = t.split(/\s+/).filter(Boolean);
  // Long article-led phrases are usually sentence starters, not concept labels.
  if (
    words.length >= 6 &&
    /^(the|a|an|this|that|these|those|it|they|there)\b/i.test(t)
  ) {
    return true;
  }
  // Mid-sentence feel: many lowercase function words and no noun-like shape.
  if (words.length >= 8) return true;

  return false;
}

function deriveTitleFromExplanation(explanation: string): string | null {
  const bullets = explanationToBullets(explanation);
  const first = bullets[0] ?? sanitizeFlashcardText(explanation).split(/[.!?]/)[0] ?? '';
  if (!first) return null;

  const labeled = first.match(
    /^(definition|mechanism|significance|formula|example|process|cause|effect)\s*[:\-–—]\s*(.+)$/i,
  );
  if (labeled?.[2]) {
    const candidate = sanitizeFlashcardText(labeled[2]).slice(0, 60);
    if (!isWeakKeyPointTitle(candidate)) return candidate;
  }

  const def = first.match(
    /^(.{2,55}?)\s+(?:is|are|means|refers to|describes|involves)\b/i,
  );
  if (def?.[1]) {
    const candidate = sanitizeFlashcardText(def[1]).replace(/:$/, '').trim();
    if (!isWeakKeyPointTitle(candidate)) return candidate;
  }

  // Prefer a short Proper-Case phrase inside the first bullet.
  const proper = first.match(
    /\b([A-Z][A-Za-z0-9]+(?:[\s/-][A-Z][A-Za-z0-9]+){0,4})\b/,
  );
  if (proper?.[1]) {
    const candidate = sanitizeFlashcardText(proper[1]);
    if (candidate.length >= 3 && candidate.length <= 50 && !isWeakKeyPointTitle(candidate)) {
      return candidate;
    }
  }

  // Last resort: first 2–4 content words (skip leading articles).
  const words = first
    .replace(/[^A-Za-z0-9\s/-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(the|a|an|this|that)$/i.test(w));
  if (words.length >= 2) {
    const candidate = words.slice(0, Math.min(4, words.length)).join(' ');
    if (!isWeakKeyPointTitle(candidate)) return candidate;
  }

  return null;
}

/**
 * Turn a raw AI title into a short, meaningful key-point label.
 * Falls back to deriving a concept name from the explanation when needed.
 */
export function normalizeKeyPointTitle(
  rawTitle: string,
  explanation?: string,
): string {
  let title = stripLeadingFlashcardJunk(rawTitle)
    .replace(/\?+$/g, '')
    .replace(/[.…]{2,}$/g, '')
    .replace(/[:\-–—]\s*$/g, '')
    .trim();

  if (isWeakKeyPointTitle(title) && explanation) {
    const recovered = deriveTitleFromExplanation(explanation);
    if (recovered) title = recovered;
  }

  title = stripLeadingFlashcardJunk(title)
    .replace(/\?+$/g, '')
    .trim();

  // Soft length cap for study UI.
  if (title.length > 64) {
    title = title.slice(0, 64).replace(/\s+\S*$/, '').trim();
  }

  return title;
}

/**
 * Split an explanation into short bullet lines for study UI.
 * Handles AI bullet lists, newlines, and plain paragraphs.
 */
export function explanationToBullets(text: string): string[] {
  const raw = sanitizeFlashcardText(text);
  if (!raw) return [];

  const stripMarker = (line: string) =>
    stripLeadingFlashcardJunk(
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
    .map((s) => stripLeadingFlashcardJunk(s))
    .filter((s) => s.length > 12);

  if (sentences.length >= 2) return sentences;

  return [stripLeadingFlashcardJunk(raw)].filter(Boolean);
}

/** Normalize stored explanation text into a consistent • bullet list. */
export function formatExplanationAsBullets(text: string): string {
  return explanationToBullets(text)
    .map((line) => `• ${stripLeadingFlashcardJunk(line)}`)
    .filter((line) => line.length > 2)
    .join('\n');
}

/** True when a bullet already looks like an Example line. */
export function isExampleBullet(line: string): boolean {
  return /^example\s*[:\-–—]/i.test(stripLeadingFlashcardJunk(line));
}

/**
 * Ensure explanations include a concrete Example bullet when one is available.
 * If `example` is provided and no Example bullet exists yet, append it.
 */
export function withExampleBullet(
  explanation: string,
  example?: string | null,
): string {
  const bullets = explanationToBullets(explanation);
  const hasExample = bullets.some(isExampleBullet);
  const extra = stripLeadingFlashcardJunk(String(example ?? ''));

  if (!hasExample && extra) {
    const labeled = /^example\s*[:\-–—]/i.test(extra)
      ? extra
      : `Example: ${extra}`;
    bullets.push(labeled);
  }

  return bullets
    .map((line) => `• ${stripLeadingFlashcardJunk(line)}`)
    .filter((line) => line.length > 2)
    .join('\n');
}
