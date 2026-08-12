/**
 * Local-first backend for Study Buddy.
 *
 * Primary storage (on device):
 *   Flashcards · Subjects · PDFs · Progress · Quizzes · Deadlines · Tutor chats · Settings
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
import type { AppSettings, Deadline, TutorChat, TutorChatMessage } from './schema';
import type { SourceKind } from './sourceMime';
import { labelForSource } from './sourceMime';
import { loadLocalDb, updateLocalDb } from './store';
import { generateFlashcardsViaGeminiPipeline } from './studyPipeline';
import type { TutorMode } from './tutorModes';
import type { QuizType } from './quizTypes';
import {
  bumpActivityDay,
  buildProgressAnalytics,
  type ProgressAnalytics,
} from './progressAnalytics';

const MAX_TUTOR_CHATS = 40;

function titleFromQuestion(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Chat';
  return cleaned.length > 56 ? `${cleaned.slice(0, 53).trimEnd()}…` : cleaned;
}

function sortTutorChats(chats: TutorChat[]): TutorChat[] {
  return [...chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

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

    let sourceId: number | undefined;
    try {
      const stored = await persistSourceFile({ name: filename, sourceType, uri });
      sourceId = stored.id;
    } catch {
      // Generation still works even if the file copy fails (e.g. web).
    }

    // Flow: upload → Gemini analysis → translate summary into flashcards
    const result = await generateFlashcardsViaGeminiPipeline({
      uri,
      sourceType,
      filename,
    });

    if (sourceId != null) {
      try {
        const { markSourceUsedForFlashcards } = await import('./pdfs');
        await markSourceUsedForFlashcards(sourceId);
      } catch {
        // Non-fatal — storage manager can still list the file.
      }
    }

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
      source_id: sourceId,
    };
  },

  async saveFlashcards(
    subjectId: number,
    cards: DraftFlashcard[],
    options?: { preserveContent?: boolean; sourceId?: number },
  ): Promise<SaveFlashcardsResponse> {
    let subject!: Subject;
    const preserve = options?.preserveContent === true;
    await updateLocalDb((db) => {
      const found = db.subjects.find((s) => s.id === subjectId);
      if (!found) throw new Error('Subject not found');
      const key = String(subjectId);
      db.flashcards[key] = db.flashcards[key] ?? [];
      for (const draft of cards) {
        const question = draft.question.trim();
        const rawAnswer = draft.answer.trim();
        const answer = preserve
          ? rawAnswer
          : formatExplanationAsBullets(rawAnswer);
        db.flashcards[key].push({
          id: db.next_card_id,
          question: preserve
            ? question
            : normalizeKeyPointTitle(question, answer),
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

    if (options?.sourceId != null) {
      try {
        const { markSourceUsedForFlashcards, maybeDeleteSourceAfterFlashcards } =
          await import('./pdfs');
        await markSourceUsedForFlashcards(options.sourceId, subjectId);
        await maybeDeleteSourceAfterFlashcards(options.sourceId);
      } catch {
        // Flashcards are already saved — storage cleanup is best-effort.
      }
    }

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
        bumpActivityDay(db, { cards_reviewed: 1 });
      }

      flashcard = { ...card };
      subject = { ...found };
      stats = publicStats(db.progress);
    });

    return { flashcard, subject, stats };
  },

  async getQuiz(
    subjectId: number | number[],
    options?: { quizType?: QuizType; size?: number },
  ): Promise<{
    questions: QuizQuestion[];
    usedAi: boolean;
    error?: string;
  }> {
    const { buildQuizQuestionsViaGemini } = await import('./quizBuilder');
    const db = await loadLocalDb();
    const ids = (Array.isArray(subjectId) ? subjectId : [subjectId]).filter(
      (id) => db.subjects.some((s) => s.id === id),
    );
    if (!ids.length) throw new Error('Subject not found');

    const cards = ids.flatMap((id) => db.flashcards[String(id)] ?? []);
    if (!cards.length) {
      return { questions: [], usedAi: false, error: 'No flashcards available' };
    }

    const quizType = options?.quizType ?? 'multiple_choice';
    const size = options?.size ?? 10;
    // Always try AI for the selected quiz type first; local card fallback only on failure.
    return buildQuizQuestionsViaGemini(cards, size, quizType);
  },

  async submitQuiz(
    subjectId: number | number[],
    answers: Record<number, { selected_index?: number | null; text?: string | null }>,
    questions: QuizQuestion[],
  ): Promise<QuizResult> {
    const { answersMatch } = await import('./quizBuilder');
    let result!: QuizResult;
    const ids = Array.isArray(subjectId) ? subjectId : [subjectId];

    await updateLocalDb((db) => {
      const subjects = db.subjects.filter((s) => ids.includes(s.id));
      if (!subjects.length) throw new Error('Subject not found');
      if (!questions.length) throw new Error('No quiz questions to grade');

      const reviews = questions.map((q) => {
        const raw = answers[q.id];
        const selectedIndex =
          raw?.selected_index === undefined || raw?.selected_index === null
            ? null
            : Number(raw.selected_index);
        const typed = String(raw?.text ?? '').trim();

        let isCorrect = false;
        let selectedAnswer: string | null = null;
        let correctAnswer =
          q.correct_text?.trim() ||
          q.options[q.correct_index] ||
          '';

        if (q.kind === 'typed_answer' || q.kind === 'fill_blank') {
          selectedAnswer = typed || null;
          isCorrect = Boolean(typed && answersMatch(correctAnswer, typed));
        } else {
          selectedAnswer =
            selectedIndex === null ? null : (q.options[selectedIndex] ?? null);
          isCorrect =
            selectedIndex !== null && selectedIndex === q.correct_index;
          correctAnswer = q.options[q.correct_index] ?? correctAnswer;
        }

        return {
          id: q.id,
          kind: q.kind,
          question: q.question,
          options: q.options,
          selected_index: selectedIndex,
          correct_index: q.correct_index,
          is_correct: isCorrect,
          correct_answer: correctAnswer,
          selected_answer: selectedAnswer,
          topic: q.topic,
        };
      });

      const score = reviews.filter((r) => r.is_correct).length;
      const total = reviews.length;
      const percentage = total ? Math.round((score / total) * 100) : 0;

      const topics_to_review = Array.from(
        new Set(
          reviews
            .filter((r) => !r.is_correct)
            .map((r) => (r.topic || '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 8);

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
      bumpActivityDay(db, { quizzes_taken: 1 });

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

      result = { score, total, percentage, message, reviews, topics_to_review };
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
      const mins = Math.max(0, Math.round(minutes));
      db.progress.focus_hours =
        Math.round((db.progress.focus_hours + mins / 60) * 10) / 10;
      bumpActivityDay(db, { focus_minutes: mins });
      stats = publicStats(db.progress);
    });
    return stats;
  },

  async getProgressAnalytics(): Promise<ProgressAnalytics> {
    const db = await loadLocalDb();
    return buildProgressAnalytics(db);
  },

  async askTutor(
    message: string,
    subject?: string,
    history?: { role: 'user' | 'assistant'; text: string }[],
    options?: {
      mode?: TutorMode;
      guideWithoutAnswer?: boolean;
    },
  ): Promise<TutorReply> {
    const { answerTutorQuestion } = await import('./tutorEngine');
    const db = await loadLocalDb();
    return answerTutorQuestion({
      message,
      subject,
      history,
      subjects: db.subjects,
      flashcardsBySubject: db.flashcards,
      mode: options?.mode,
      guideWithoutAnswer: options?.guideWithoutAnswer,
    });
  },

  async getSettings() {
    const db = await loadLocalDb();
    return db.settings;
  },

  async updateSettings(patch: Partial<AppSettings>) {
    let settings: AppSettings;
    await updateLocalDb((db) => {
      db.settings = { ...db.settings, ...patch };
      settings = db.settings;
    });
    return settings!;
  },

  async getStorageBreakdown() {
    const { getStorageBreakdown } = await import('./storageManager');
    return getStorageBreakdown();
  },

  async setSourceKeep(sourceId: number, keep: boolean) {
    const { setSourceKeep } = await import('./pdfs');
    return setSourceKeep(sourceId, keep);
  },

  async deleteStoredSource(sourceId: number) {
    const { deleteStoredSource } = await import('./pdfs');
    return deleteStoredSource(sourceId);
  },

  async deleteDisposableSources() {
    const { deleteDisposableSources } = await import('./pdfs');
    return deleteDisposableSources();
  },

  async getDeadlines(): Promise<Deadline[]> {
    const db = await loadLocalDb();
    return db.deadlines;
  },

  async createDeadline(title: string, dueDate: string): Promise<Deadline> {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Deadline title is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new Error('Due date must be YYYY-MM-DD');
    }

    let created!: Deadline;
    await updateLocalDb((db) => {
      created = {
        id: db.next_deadline_id,
        title: trimmed,
        due_date: dueDate,
        completed: false,
        created_at: new Date().toISOString(),
      };
      db.next_deadline_id += 1;
      db.deadlines.push(created);
    });
    return created;
  },

  async completeDeadline(id: number): Promise<Deadline> {
    let updated!: Deadline;
    await updateLocalDb((db) => {
      const item = db.deadlines.find((d) => d.id === id);
      if (!item) throw new Error('Deadline not found');
      item.completed = true;
      updated = item;
    });
    return updated;
  },

  async deleteDeadline(id: number): Promise<void> {
    await updateLocalDb((db) => {
      const before = db.deadlines.length;
      db.deadlines = db.deadlines.filter((d) => d.id !== id);
      if (db.deadlines.length === before) throw new Error('Deadline not found');
    });
  },

  async getTutorChats(): Promise<TutorChat[]> {
    const db = await loadLocalDb();
    return sortTutorChats(db.tutor_chats);
  },

  async getTutorChat(id: number): Promise<TutorChat> {
    const db = await loadLocalDb();
    const chat = db.tutor_chats.find((c) => c.id === id);
    if (!chat) throw new Error('Chat not found');
    return chat;
  },

  async createTutorChat(input: {
    subject?: string;
    messages: Omit<TutorChatMessage, 'created_at'>[];
  }): Promise<TutorChat> {
    if (!input.messages.length) throw new Error('Chat needs at least one message');

    const now = new Date().toISOString();
    const firstUser = input.messages.find((m) => m.role === 'user');
    let created!: TutorChat;

    await updateLocalDb((db) => {
      created = {
        id: db.next_tutor_chat_id,
        subject: input.subject?.trim() || undefined,
        title: titleFromQuestion(firstUser?.text ?? 'Chat'),
        messages: input.messages.map((m) => ({
          role: m.role,
          text: m.text,
          allow_flashcards: m.allow_flashcards,
          created_at: now,
        })),
        created_at: now,
        updated_at: now,
      };
      db.next_tutor_chat_id += 1;
      db.tutor_chats.unshift(created);
      if (db.tutor_chats.length > MAX_TUTOR_CHATS) {
        db.tutor_chats = sortTutorChats(db.tutor_chats).slice(0, MAX_TUTOR_CHATS);
      }
    });
    return created;
  },

  async appendTutorChatMessages(
    id: number,
    messages: Omit<TutorChatMessage, 'created_at'>[],
  ): Promise<TutorChat> {
    if (!messages.length) throw new Error('No messages to append');

    const now = new Date().toISOString();
    let updated!: TutorChat;
    await updateLocalDb((db) => {
      const chat = db.tutor_chats.find((c) => c.id === id);
      if (!chat) throw new Error('Chat not found');
      chat.messages.push(
        ...messages.map((m) => ({
          role: m.role,
          text: m.text,
          allow_flashcards: m.allow_flashcards,
          created_at: now,
        })),
      );
      chat.updated_at = now;
      if (!chat.title || chat.title === 'Chat') {
        const firstUser = chat.messages.find((m) => m.role === 'user');
        if (firstUser) chat.title = titleFromQuestion(firstUser.text);
      }
      updated = chat;
    });
    return updated;
  },

  async deleteTutorChat(id: number): Promise<void> {
    await updateLocalDb((db) => {
      const before = db.tutor_chats.length;
      db.tutor_chats = db.tutor_chats.filter((c) => c.id !== id);
      if (db.tutor_chats.length === before) throw new Error('Chat not found');
    });
  },
};
