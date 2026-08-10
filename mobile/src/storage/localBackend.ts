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
import { formatExplanationAsBullets, normalizeKeyPointTitle } from './explanationFormat';
import { persistSourceFile } from './pdfs';
import type { SourceKind } from './sourceMime';
import { labelForSource } from './sourceMime';
import { loadLocalDb, updateLocalDb } from './store';
import { generateFlashcardsViaGeminiPipeline } from './studyPipeline';

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
    sourceType: SourceKind,
    filename: string,
    uri?: string,
  ): Promise<GenerateDraftResponse> {
    if (!uri) {
      throw new Error(
        'A file URI is required so Gemini can analyze your notes.',
      );
    }

    try {
      await persistSourceFile({ name: filename, sourceType, uri });
    } catch {
      // Generation still works even if the file copy fails (e.g. web).
    }

    // Flow: upload → Gemini analysis → translate summary into flashcards
    const result = await generateFlashcardsViaGeminiPipeline({
      uri,
      sourceType,
      filename,
    });

    const sample = result.cards[0];
    const overviewBit = result.overview
      ? ` Overview: ${result.overview.slice(0, 160)}${result.overview.length > 160 ? '…' : ''}`
      : '';

    const photoFlowBit =
      sourceType === 'photo'
        ? ' Exact text was copied from the photo, important points were summarized, then flashcards were built.'
        : '';

    return {
      count: result.cards.length,
      cards: result.cards,
      sample_question: sample.question,
      sample_answer: sample.answer,
      message:
        `${result.cards.length} review flashcards were created from Gemini’s analysis of "${filename}" (${labelForSource(sourceType)}).` +
        photoFlowBit +
        overviewBit +
        ' Choose a subject to save them.',
      filename,
      source_type: sourceType,
      extraction_method: sourceType === 'photo' ? 'ocr' : 'gemini',
      overview: result.overview,
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
        const answer = formatExplanationAsBullets(draft.answer);
        db.flashcards[key].push({
          id: db.next_card_id,
          question: normalizeKeyPointTitle(draft.question, answer),
          answer,
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

      const changed = card.mastered !== mastered;
      card.mastered = mastered;
      found.cards = cards.length;
      found.mastered = recountMastered(cards);
      found.last = 'Just now';
      // Count a review only when mastery state actually changes.
      if (changed) {
        db.progress.flashcards_reviewed += 1;
      }

      flashcard = { ...card };
      subject = { ...found };
      stats = publicStats(db.progress);
    });

    return { flashcard, subject, stats };
  },

  async getQuiz(subjectId: number | number[]): Promise<QuizQuestion[]> {
    const { buildQuizQuestionsViaGemini } = await import('./quizBuilder');
    const db = await loadLocalDb();
    const ids = (Array.isArray(subjectId) ? subjectId : [subjectId]).filter(
      (id) => db.subjects.some((s) => s.id === id),
    );
    if (!ids.length) throw new Error('Subject not found');

    const cards = ids.flatMap((id) => db.flashcards[String(id)] ?? []);
    if (!cards.length) return [];

    const result = await buildQuizQuestionsViaGemini(cards, 20);
    return result.questions;
  },

  async submitQuiz(
    subjectId: number | number[],
    answers: Record<number, number>,
    questions: QuizQuestion[],
  ): Promise<QuizResult> {
    let result!: QuizResult;
    const ids = Array.isArray(subjectId) ? subjectId : [subjectId];

    await updateLocalDb((db) => {
      const subjects = db.subjects.filter((s) => ids.includes(s.id));
      if (!subjects.length) throw new Error('Subject not found');
      if (!questions.length) throw new Error('No quiz questions to grade');

      const reviews = questions.map((q) => {
        const selectedIndex =
          answers[q.id] === undefined ? null : Number(answers[q.id]);
        const isCorrect =
          selectedIndex !== null && selectedIndex === q.correct_index;
        return {
          id: q.id,
          question: q.question,
          options: q.options,
          selected_index: selectedIndex,
          correct_index: q.correct_index,
          is_correct: isCorrect,
          correct_answer: q.options[q.correct_index] ?? '',
          selected_answer:
            selectedIndex === null ? null : (q.options[selectedIndex] ?? null),
        };
      });

      const score = reviews.filter((r) => r.is_correct).length;
      const total = reviews.length;
      const percentage = total ? Math.round((score / total) * 100) : 0;

      for (const review of reviews) {
        if (!review.is_correct) continue;
        // Only mark flashcards when the question id still maps to a real card
        // (local fallback). Gemini-generated questions use synthetic ids.
        for (const id of ids) {
          const card = (db.flashcards[String(id)] ?? []).find(
            (c) => c.id === review.id,
          );
          if (card) card.mastered = true;
        }
      }

      for (const subject of subjects) {
        const cards = db.flashcards[String(subject.id)] ?? [];
        subject.mastered = recountMastered(cards);
        subject.cards = cards.length;
        subject.last = 'Just now';
      }

      const taken = db.progress.quizzes_taken;
      if (taken === 0) db.progress.quiz_average = percentage;
      else db.progress.quiz_average = Math.round((db.progress.quiz_average + percentage) / 2);
      db.progress.quizzes_taken = taken + 1;

      db.quizzes.push({
        id: db.quizzes.length + 1,
        subject_id: ids[0],
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

      result = { score, total, percentage, message, reviews };
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

  async askTutor(
    message: string,
    subject?: string,
    history?: { role: 'user' | 'assistant'; text: string }[],
  ): Promise<TutorReply> {
    const { answerTutorQuestion } = await import('./tutorEngine');
    const db = await loadLocalDb();
    return answerTutorQuestion({
      message,
      subject,
      history,
      subjects: db.subjects,
      flashcardsBySubject: db.flashcards,
    });
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
