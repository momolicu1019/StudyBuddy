import type { Flashcard, Subject, TutorReply } from '../api/types';
import { isAiConfigured } from './aiConfig';
import { sanitizeStudyText } from './explanationFormat';
import { friendlyAiError, generateAiText } from './geminiClient';
import {
  guideWithoutAnswerInstruction,
  modeAllowsFlashcards,
  modeInstruction,
  type TutorMode,
} from './tutorModes';

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
  mode?: TutorMode;
  guideWithoutAnswer?: boolean;
};

export { isAiConfigured as isCloudTutorConfigured };
export type { TutorMode } from './tutorModes';
export {
  TUTOR_MODES,
  tutorModeById,
  modeAllowsFlashcards,
} from './tutorModes';

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

  const mode: TutorMode = ctx.mode ?? 'explain';
  const guide = ctx.guideWithoutAnswer === true;
  const { topic, notes } = gatherRelevantNotes(ctx);
  const notesBlock =
    notes.length > 0
      ? notes
          .map(
            (n, i) =>
              `${i + 1}. [${n.subject}] Key point: ${n.question}\n   Summary: ${n.answer}`,
          )
          .join('\n')
      : '(No on-device flashcard notes for this question — answer from solid general knowledge.)';

  const history = (ctx.history ?? [])
    .filter((m) => m.text.trim())
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? 'Tutor' : 'Student'}: ${m.text}`)
    .join('\n');

  const system = [
    'You are Study Buddy AI Tutor, a friendly and accurate study coach.',
    modeInstruction(mode),
    guide ? guideWithoutAnswerInstruction() : '',
    guide || mode === 'hint' || mode === 'test'
      ? 'Prefer questions and short coaching over long lectures.'
      : 'Answer the student question clearly with useful academic content.',
    'Use short paragraphs, numbered steps, or bullets when helpful.',
    'Write plain text only — never use markdown (no **, __, *, #, backticks) and never use LaTeX or math markup (no $, $$, \\frac, \\times, \\text{}).',
    'For formulas, write normal readable text with unicode symbols when useful (for example: V_total = V_1 = V_2 = … and V = I × R).',
    'Prefer facts from the student notes when they are relevant.',
    'If notes are missing or incomplete, still teach the topic using solid general knowledge — do not apologize about missing flashcards.',
    'Never say phrases like “since you don’t have flashcards”, “I couldn’t find matching flashcards”, or “generate flashcards first”.',
    'Never end with tips about uploading notes, creating flashcards, or app features — stay on the subject matter.',
    guide || mode === 'hint' || mode === 'test'
      ? 'Keep replies concise (about 40–120 words).'
      : 'Keep replies concise (about 80–180 words) unless the student asks for more detail.',
    `Current subject focus: ${topic}.`,
  ]
    .filter(Boolean)
    .join(' ');

  const userContent = [
    history ? `Recent chat:\n${history}\n` : '',
    `Help mode: ${mode}${guide ? ' · guide without giving the answer' : ''}`,
    `Student request:\n${ctx.message}`,
    '',
    `Relevant notes from the student's flashcards:\n${notesBlock}`,
  ]
    .filter(Boolean)
    .join('\n');

  const reply = await generateAiText({
    system,
    user: userContent,
    temperature: guide || mode === 'hint' || mode === 'test' ? 0.5 : 0.4,
  });
  return reply ? sanitizeStudyText(reply) : null;
}

function answerFromNotes(ctx: TutorContext): string {
  const mode: TutorMode = ctx.mode ?? 'explain';
  const guide = ctx.guideWithoutAnswer === true;
  const { topic, notes } = gatherRelevantNotes(ctx);
  const question = ctx.message.trim();
  const lower = question.toLowerCase();

  if (guide || mode === 'hint') {
    const best = notes.find((n) => n.score > 0);
    const focus = best?.question ?? topic;
    return (
      `Let's work through it together.\n\n` +
      `What information does the problem (or topic “${focus}”) already give you?\n\n` +
      `Name one fact you know for sure, and I’ll help you take the next step — without handing you the full answer.`
    );
  }

  if (mode === 'test') {
    const best = notes.find((n) => n.score > 0);
    if (best) {
      return (
        `Quick check on ${topic}:\n\n` +
        `In your own words, what is “${best.question}”?\n\n` +
        `Reply with your answer and I’ll help you check it.`
      );
    }
    return (
      `Quick check on ${topic}:\n\n` +
      `What’s one key idea from your notes you can explain without looking?\n\n` +
      `Send your answer and we’ll review it together.`
    );
  }

  const matched = notes.filter((n) => n.score > 0);
  if (matched.length > 0) {
    const best = matched[0];
    const extras = matched.slice(1, 3);

    if (mode === 'summarize') {
      const lines = [best, ...extras].map((n) => `• ${n.question}: ${n.answer}`);
      return `Here’s a short summary for ${topic}:\n${lines.join('\n')}`;
    }

    if (mode === 'example') {
      return (
        `Example for “${best.question}”:\n\n` +
        `${best.answer}\n\n` +
        `Try restating that example in one sentence to lock it in.`
      );
    }

    if (mode === 'explain_simply') {
      return (
        `In simple terms — ${best.question}:\n\n` +
        `${best.answer}\n\n` +
        `Think of it as one main idea you can say out loud in under 20 seconds.`
      );
    }

    if (mode === 'another_way') {
      return (
        `Another way to look at “${best.question}”:\n\n` +
        `${best.answer}\n\n` +
        `Picture teaching this to a friend who never heard the term before — what would you say first?`
      );
    }

    let reply = best.answer.trim();
    if (extras.length) {
      reply +=
        `\n\nRelated points:\n` +
        extras.map((n) => `• ${n.answer}`).join('\n');
    }
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
    `I couldn't find matching notes for that yet.\n\n` +
    `You asked: “${question}”\n\n` +
    (isAiConfigured()
      ? 'Live AI could not answer this one. Try again in a moment.'
      : 'AI isn’t available right now. Try asking about a topic from your notes.')
  );
}

/**
 * True when the reply is real study content worth turning into flashcards.
 * False for API errors, empty coaching, and “try again” messages.
 */
export function isFlashcardWorthyTutorReply(reply: string): boolean {
  const text = reply.trim();
  if (text.length < 60) return false;

  const blocklist = [
    /couldn'?t get a live ai answer/i,
    /i could not answer that just now/i,
    /please try asking again/i,
    /try asking again in a moment/i,
    /ai isn'?t available right now/i,
    /live ai could not answer/i,
    /couldn'?t find matching (flashcards|notes)/i,
    /generate flashcards from your notes first/i,
    /ask me anything about your notes/i,
  ];
  return !blocklist.some((pattern) => pattern.test(text));
}

/**
 * Answer a student question using cloud AI when configured,
 * otherwise answer from on-device flashcards / clear guidance.
 */
export async function answerTutorQuestion(
  ctx: TutorContext,
): Promise<TutorReply> {
  const text = ctx.message.trim();
  const mode: TutorMode = ctx.mode ?? 'explain';
  const guide = ctx.guideWithoutAnswer === true;

  if (!text) {
    return {
      reply: "Ask me anything about your notes — I'll explain it step by step.",
      allow_flashcards: false,
    };
  }

  const allowByMode = modeAllowsFlashcards(mode, guide);

  try {
    const cloud = await askCloudTutor({ ...ctx, message: text });
    if (cloud) {
      const reply = sanitizeStudyText(cloud);
      return {
        reply,
        allow_flashcards: allowByMode && isFlashcardWorthyTutorReply(reply),
      };
    }
  } catch (error) {
    if (isAiConfigured()) {
      return {
        reply:
          `I couldn't get a live AI answer just now.\n\n${friendlyAiError(error)}\n\n` +
          'You can try asking again, or study from your flashcards in the meantime.',
        allow_flashcards: false,
      };
    }
    const reply = sanitizeStudyText(answerFromNotes({ ...ctx, message: text }));
    return {
      reply,
      allow_flashcards: allowByMode && isFlashcardWorthyTutorReply(reply),
    };
  }

  const reply = sanitizeStudyText(answerFromNotes({ ...ctx, message: text }));
  return {
    reply,
    allow_flashcards: allowByMode && isFlashcardWorthyTutorReply(reply),
  };
}
