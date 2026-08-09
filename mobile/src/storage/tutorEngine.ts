import type { Flashcard, Subject, TutorReply } from '../api/types';
import { isAiConfigured } from './aiConfig';
import { friendlyAiError, generateAiText } from './geminiClient';

export type TutorMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type TutorContext = {
  message: string;
  subject?: string;
  history?: TutorMessage[];
  subjects: Subject[];
  flashcardsBySubject: Record<string, Flashcard[]>;
};

export { isAiConfigured as isCloudTutorConfigured };

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .filter(
      (w) =>
        ![
          'the',
          'and',
          'for',
          'are',
          'was',
          'were',
          'what',
          'how',
          'why',
          'when',
          'where',
          'who',
          'does',
          'did',
          'can',
          'could',
          'would',
          'should',
          'with',
          'from',
          'that',
          'this',
          'into',
          'about',
          'please',
          'explain',
          'tell',
          'mean',
          'means',
        ].includes(w),
    );
}

function scoreCard(queryTokens: string[], card: Flashcard): number {
  const hay = `${card.question} ${card.answer}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) score += token.length > 5 ? 2 : 1;
  }
  return score;
}

function gatherRelevantNotes(ctx: TutorContext): {
  topic: string;
  notes: { subject: string; question: string; answer: string; score: number }[];
} {
  const topic =
    ctx.subject?.trim() ||
    ctx.subjects.find((s) =>
      ctx.message.toLowerCase().includes(s.name.toLowerCase()),
    )?.name ||
    'your studies';

  const queryTokens = tokenize(ctx.message);
  const notes: {
    subject: string;
    question: string;
    answer: string;
    score: number;
  }[] = [];

  for (const subject of ctx.subjects) {
    if (
      ctx.subject &&
      subject.name.toLowerCase() !== ctx.subject.trim().toLowerCase()
    ) {
      continue;
    }
    const cards = ctx.flashcardsBySubject[String(subject.id)] ?? [];
    for (const card of cards) {
      const score = scoreCard(queryTokens, card);
      if (score <= 0) continue;
      notes.push({
        subject: `${subject.icon} ${subject.name}`,
        question: card.question,
        answer: card.answer,
        score,
      });
    }
  }

  // If focused subject had no keyword hits, search all subjects.
  if (notes.length === 0 && ctx.subject) {
    for (const subject of ctx.subjects) {
      const cards = ctx.flashcardsBySubject[String(subject.id)] ?? [];
      for (const card of cards) {
        const score = scoreCard(queryTokens, card);
        if (score <= 0) continue;
        notes.push({
          subject: `${subject.icon} ${subject.name}`,
          question: card.question,
          answer: card.answer,
          score,
        });
      }
    }
  }

  notes.sort((a, b) => b.score - a.score);
  let top = notes.slice(0, 6);

  // If a subject was specified and we found nothing, broaden to all cards lightly.
  if (top.length === 0 && ctx.subject) {
    for (const subject of ctx.subjects) {
      const cards = ctx.flashcardsBySubject[String(subject.id)] ?? [];
      for (const card of cards.slice(0, 8)) {
        top.push({
          subject: `${subject.icon} ${subject.name}`,
          question: card.question,
          answer: card.answer,
          score: 0,
        });
      }
    }
    top = top.slice(0, 4);
  }

  return { topic, notes: top };
}

async function askCloudTutor(ctx: TutorContext): Promise<string | null> {
  if (!isAiConfigured()) return null;

  const { topic, notes } = gatherRelevantNotes(ctx);
  const notesBlock =
    notes.length > 0
      ? notes
          .map(
            (n, i) =>
              `${i + 1}. [${n.subject}] Key point: ${n.question}\n   Summary: ${n.answer}`,
          )
          .join('\n')
      : 'No matching flashcards were found on device.';

  const history = (ctx.history ?? [])
    .filter((m) => m.text.trim())
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? 'Tutor' : 'Student'}: ${m.text}`)
    .join('\n');

  const system = [
    'You are Study Buddy AI Tutor, a friendly and accurate study coach.',
    'Answer the student question directly and clearly.',
    'Use short paragraphs or numbered steps when helpful.',
    'Prefer facts from the student notes when they are relevant.',
    'If notes are incomplete, still answer the question using solid general knowledge, and say what is from notes vs general knowledge.',
    'Keep replies concise (about 80–180 words) unless the student asks for more detail.',
    `Current subject focus: ${topic}.`,
  ].join(' ');

  const userContent = [
    history ? `Recent chat:\n${history}\n` : '',
    `Student question:\n${ctx.message}`,
    '',
    `Relevant notes from the student's flashcards:\n${notesBlock}`,
  ]
    .filter(Boolean)
    .join('\n');

  const reply = await generateAiText({
    system,
    user: userContent,
    temperature: 0.4,
  });
  return reply || null;
}

function answerFromNotes(ctx: TutorContext): string {
  const { topic, notes } = gatherRelevantNotes(ctx);
  const question = ctx.message.trim();
  const lower = question.toLowerCase();

  const matched = notes.filter((n) => n.score > 0);
  if (matched.length > 0) {
    const best = matched[0];
    const extras = matched.slice(1, 3);
    let reply =
      `Here's a direct answer based on your ${topic} notes:\n\n` +
      `${best.answer}\n\n` +
      `That comes from your card: “${best.question}”.`;

    if (extras.length) {
      reply +=
        `\n\nRelated points from your flashcards:\n` +
        extras.map((n) => `• ${n.answer}`).join('\n');
    }

    reply +=
      '\n\nIf you want, ask a follow-up like “give an example” or “quiz me on this”.';
    return reply;
  }

  // Study-skills intents still get practical coaching.
  if (/(flashcard|study plan|how (do|should) i study|spaced repetition)/i.test(lower)) {
    return (
      `For ${topic}, use active recall:\n` +
      '1) Read one idea\n' +
      '2) Hide it and say the answer out loud\n' +
      '3) Check your flashcard\n' +
      '4) Repeat missed cards tomorrow\n\n' +
      `Your question was: “${question}” — if you ask about a specific concept from your notes, I can explain that concept directly.`
    );
  }

  if (/(quiz|test|exam)/i.test(lower)) {
    return (
      `Before a quiz on ${topic}:\n` +
      '1) Warm up with 5 cards you previously missed\n' +
      '2) Do one short practice set\n' +
      '3) Review only the misses\n\n' +
      'Ask me a content question (for example “What is mitosis?”) and I’ll answer that topic directly.'
    );
  }

  // No notes + no API: be honest, but still engage the actual question.
  return (
    `I couldn't find matching flashcards for that yet.\n\n` +
    `You asked: “${question}”\n\n` +
    (isAiConfigured()
      ? 'Live AI could not answer this one. Try again in a moment.'
      : 'AI isn’t available right now. You can still ask about topics from your flashcards.') +
    '\n\nTip: generate flashcards from your notes first, then ask about those topics.'
  );
}

/**
 * Answer a student question using cloud AI when configured,
 * otherwise answer from on-device flashcards / clear guidance.
 */
export async function answerTutorQuestion(
  ctx: TutorContext,
): Promise<TutorReply> {
  const text = ctx.message.trim();
  if (!text) {
    return {
      reply: "Ask me anything about your notes — I'll explain it step by step.",
    };
  }

  try {
    const cloud = await askCloudTutor({ ...ctx, message: text });
    if (cloud) return { reply: cloud };
  } catch (error) {
    if (isAiConfigured()) {
      return {
        reply:
          `I couldn't get a live AI answer just now.\n\n${friendlyAiError(error)}\n\n` +
          'You can try asking again, or study from your flashcards in the meantime.',
      };
    }
    return { reply: answerFromNotes({ ...ctx, message: text }) };
  }

  return { reply: answerFromNotes({ ...ctx, message: text }) };
}
