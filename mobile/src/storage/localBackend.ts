/**
 * Local-first backend for Study Buddy.
 *
 * Primary storage (on device):
 *   Flashcards · Subjects · PDFs · Progress · Quizzes · Settings
 *
 * Optional cloud (stubs in ./cloud.ts):
 *   Backup · Account · Sync · Devices
 */

import type {
  DraftFlashcard,
  Flashcard,
  GenerateDraftResponse,
  QuizQuestion,
  QuizResult,
  ReviewResponse,
  SaveFlashcardsResponse,
  Stats,
  Subject,
  TutorReply,
} from '../api/types';
import { persistSourceFile } from './pdfs';
import { loadLocalDb, updateLocalDb } from './store';

const DISTRACTORS = [
  'Not enough information',
  'All of the above',
  'None of the above',
  'It depends on context',
];

function recountMastered(cards: Flashcard[]): number {
  return cards.filter((c) => c.mastered).length;
}

function publicStats(progress: {
  flashcards_reviewed: number;
  quiz_average: number;
  focus_hours: number;
}): Stats {
  return {
    flashcards_reviewed: progress.flashcards_reviewed,
    quiz_average: progress.quiz_average,
    focus_hours: progress.focus_hours,
  };
}

function buildDraftCards(
  sourceType: 'pdf' | 'photo',
  filename: string,
): DraftFlashcard[] {
  const stem =
    filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'your notes';
  const count = sourceType === 'photo' ? 8 : 12;
  return Array.from({ length: count }, (_, i) => ({
    question: `What is key point #${i + 1} from ${stem}?`,
    answer: `Summarize point #${i + 1} from your ${sourceType} notes in “${stem}” using your own words.`,
  }));
}

export const localBackend = {
  async getSubjects(q?: string): Promise<Subject[]> {
    const db = await loadLocalDb();
    if (!q?.trim()) return db.subjects;
    const needle = q.trim().toLowerCase();
    return db.subjects.filter((s) => s.name.toLowerCase().includes(needle));
  },

  async createSubject(name: string, icon: string): Promise<Subject> {
    let created!: Subject;
    await updateLocalDb((db) => {
      created = {
        id: db.next_subject_id,
        name: name.trim(),
        icon,
        cards: 0,
        mastered: 0,
        last: 'Not studied yet',
      };
      db.next_subject_id += 1;
      db.subjects.push(created);
      db.flashcards[String(created.id)] = [];
    });
    return created;
  },

  async updateSubject(id: number, name: string, icon: string): Promise<Subject> {
    let updated!: Subject;
    await updateLocalDb((db) => {
      const subject = db.subjects.find((s) => s.id === id);
      if (!subject) throw new Error('Subject not found');
      subject.name = name.trim();
      subject.icon = icon;
      updated = subject;
    });
    return updated;
  },

  async deleteSubject(id: number): Promise<void> {
    await updateLocalDb((db) => {
      const before = db.subjects.length;
      db.subjects = db.subjects.filter((s) => s.id !== id);
      if (db.subjects.length === before) throw new Error('Subject not found');
      delete db.flashcards[String(id)];
      db.pdfs = db.pdfs.map((p) =>
        p.subject_id === id ? { ...p, subject_id: undefined } : p,
      );
    });
  },

  async getFlashcards(subjectId: number): Promise<Flashcard[]> {
    const db = await loadLocalDb();
    if (!db.subjects.some((s) => s.id === subjectId)) {
      throw new Error('Subject not found');
    }
    return db.flashcards[String(subjectId)] ?? [];
  },

  async generateFlashcards(
    sourceType: 'pdf' | 'photo',
    filename: string,
    uri?: string,
  ): Promise<GenerateDraftResponse> {
    if (uri) {
      try {
        await persistSourceFile({ name: filename, sourceType, uri });
      } catch {
        // Generation still works even if the file copy fails (e.g. web).
      }
    }

    const cards = buildDraftCards(sourceType, filename);
    const sample = cards[0];
    return {
      count: cards.length,
      cards,
      sample_question: sample.question,
      sample_answer: sample.answer,
      message: `${cards.length} flashcards were generated from "${filename}". Choose a folder to save them.`,
      filename,
      source_type: sourceType,
    };
  },

  async saveFlashcards(
    subjectId: number,
    cards: DraftFlashcard[],
  ): Promise<SaveFlashcardsResponse> {
    let subject!: Subject;
    await updateLocalDb((db) => {
      const found = db.subjects.find((s) => s.id === subjectId);
      if (!found) throw new Error('Subject not found');
      const key = String(subjectId);
      db.flashcards[key] = db.flashcards[key] ?? [];
      for (const draft of cards) {
        db.flashcards[key].push({
          id: db.next_card_id,
          question: draft.question,
          answer: draft.answer,
          mastered: false,
        });
        db.next_card_id += 1;
      }
      found.cards = db.flashcards[key].length;
      found.mastered = recountMastered(db.flashcards[key]);
      found.last = 'Just now';
      subject = { ...found };
    });

    return {
      count: cards.length,
      subject,
      message: `${cards.length} flashcards were saved to ${subject.icon} ${subject.name}.`,
    };
  },

  async reviewFlashcard(
    subjectId: number,
    cardId: number,
    mastered: boolean,
  ): Promise<ReviewResponse> {
    let flashcard!: Flashcard;
    let subject!: Subject;
    let stats!: Stats;

    await updateLocalDb((db) => {
      const found = db.subjects.find((s) => s.id === subjectId);
      if (!found) throw new Error('Subject not found');
      const cards = db.flashcards[String(subjectId)] ?? [];
      const card = cards.find((c) => c.id === cardId);
      if (!card) throw new Error('Flashcard not found');

      card.mastered = mastered;
      found.cards = cards.length;
      found.mastered = recountMastered(cards);
      found.last = 'Just now';
      db.progress.flashcards_reviewed += 1;

      flashcard = { ...card };
      subject = { ...found };
      stats = publicStats(db.progress);
    });

    return { flashcard, subject, stats };
  },

  async getQuiz(subjectId: number): Promise<QuizQuestion[]> {
    const db = await loadLocalDb();
    if (!db.subjects.some((s) => s.id === subjectId)) {
      throw new Error('Subject not found');
    }
    const cards = db.flashcards[String(subjectId)] ?? [];
    if (!cards.length) return [];

    const distractors = [...DISTRACTORS];
    return cards.slice(0, 8).map((card) => {
      const question: QuizQuestion = {
        id: card.id,
        question: card.question,
        options: [card.answer, ...distractors.slice(0, 3)],
        correct_index: 0,
      };
      distractors.push(distractors.shift()!);
      return question;
    });
  },

  async submitQuiz(
    subjectId: number,
    answers: Record<number, number>,
  ): Promise<QuizResult> {
    let result!: QuizResult;

    await updateLocalDb((db) => {
      const subject = db.subjects.find((s) => s.id === subjectId);
      if (!subject) throw new Error('Subject not found');
      const cards = db.flashcards[String(subjectId)] ?? [];
      if (!cards.length || !Object.keys(answers).length) {
        throw new Error('No quiz answers to grade');
      }

      let score = 0;
      for (const [cardId, answerIndex] of Object.entries(answers)) {
        if (answerIndex === 0) {
          score += 1;
          const card = cards.find((c) => c.id === Number(cardId));
          if (card) card.mastered = true;
        }
      }

      const total = Object.keys(answers).length;
      const percentage = Math.round((score / total) * 100);
      subject.mastered = recountMastered(cards);
      subject.cards = cards.length;
      subject.last = 'Just now';

      const taken = db.progress.quizzes_taken;
      if (taken === 0) db.progress.quiz_average = percentage;
      else db.progress.quiz_average = Math.round((db.progress.quiz_average + percentage) / 2);
      db.progress.quizzes_taken = taken + 1;

      db.quizzes.push({
        id: db.quizzes.length + 1,
        subject_id: subjectId,
        score,
        total,
        percentage,
        created_at: new Date().toISOString(),
      });

      let message: string;
      if (percentage >= 80) message = "Great work — you're mastering this subject!";
      else if (percentage >= 50)
        message = 'Solid effort. Review the missed cards and try again.';
      else message = 'Keep going! Study the flashcards, then retake the quiz.';

      result = { score, total, percentage, message };
    });

    return result;
  },

  async getStats(): Promise<Stats> {
    const db = await loadLocalDb();
    return publicStats(db.progress);
  },

  async logFocus(minutes: number): Promise<Stats> {
    let stats!: Stats;
    await updateLocalDb((db) => {
      db.progress.focus_hours =
        Math.round((db.progress.focus_hours + minutes / 60) * 10) / 10;
      stats = publicStats(db.progress);
    });
    return stats;
  },

  async askTutor(message: string, subject?: string): Promise<TutorReply> {
    const topic = subject || 'your studies';
    const text = message.trim();
    if (!text) {
      return {
        reply: "Ask me anything about your notes — I'll break it down step by step.",
      };
    }

    const lower = text.toLowerCase();
    if (lower.includes('flashcard') || lower.includes('card')) {
      return {
        reply:
          `For ${topic}, start with active recall: hide the answer, say it out loud, ` +
          'then check. Spaced repetition beats rereading every time.',
      };
    }
    if (lower.includes('quiz') || lower.includes('test')) {
      return {
        reply:
          `Before a quiz on ${topic}, do a quick warm-up: 5 flashcards you got wrong last time, ` +
          'then one timed practice set. Review only the misses afterward.',
      };
    }
    if (lower.includes('explain') || lower.includes('how') || lower.includes('what')) {
      return {
        reply:
          `Let's break that down for ${topic}.\n\n` +
          '1) Restate the question in your own words.\n' +
          `2) Identify the core idea behind: "${text}".\n` +
          '3) Connect it to one example you already know.\n' +
          '4) Teach it back in one sentence.\n\n' +
          'Want a worked example next?',
      };
    }

    return {
      reply:
        `Here's a study plan for ${topic} based on your question:\n\n` +
        `• Clarify: "${text}"\n` +
        '• Study 10 focused minutes with flashcards\n' +
        '• Explain the idea out loud (Voice Explain)\n' +
        '• Take a short quiz to lock it in\n\n' +
        "Ask a follow-up and I'll go deeper step by step.",
    };
  },

  async getSettings() {
    const db = await loadLocalDb();
    return db.settings;
  },

  async updateSettings(patch: Partial<{ cloud_sync_enabled: boolean; daily_goal_minutes: number }>) {
    let settings;
    await updateLocalDb((db) => {
      db.settings = { ...db.settings, ...patch };
      settings = db.settings;
    });
    return settings!;
  },
};
