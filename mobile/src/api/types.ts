export type Subject = {
  id: number;
  name: string;
  icon: string;
  cards: number;
  mastered: number;
  last: string;
};

export type Flashcard = {
  id: number;
  question: string;
  answer: string;
  mastered: boolean;
};

export type DraftFlashcard = {
  question: string;
  answer: string;
};

export type Stats = {
  flashcards_reviewed: number;
  quiz_average: number;
  focus_hours: number;
};

export type GenerateDraftResponse = {
  count: number;
  cards: DraftFlashcard[];
  sample_question: string;
  sample_answer: string;
  message: string;
  filename: string;
  source_type: string;
  warning?: string;
  extraction_method?: 'pdf-text' | 'ocr' | 'empty' | 'gemini';
  overview?: string;
  /** Local stored source copy id (for storage cleanup after save). */
  source_id?: number;
};

export type SaveFlashcardsResponse = {
  count: number;
  subject: Subject;
  message: string;
};

export type ReviewResponse = {
  flashcard: Flashcard;
  subject: Subject;
  stats: Stats;
};

export type QuizQuestionKind =
  | 'multiple_choice'
  | 'typed_answer'
  | 'true_false'
  | 'fill_blank';

export type QuizQuestion = {
  id: number;
  kind: QuizQuestionKind;
  question: string;
  options: string[];
  correct_index: number;
  /** Expected text for typed / fill-in answers. */
  correct_text?: string;
  /** Concept / topic label used on the results “review” list. */
  topic?: string;
};

export type QuizQuestionReview = {
  id: number;
  kind: QuizQuestionKind;
  question: string;
  options: string[];
  selected_index: number | null;
  correct_index: number;
  is_correct: boolean;
  correct_answer: string;
  selected_answer: string | null;
  topic?: string;
};

export type QuizResult = {
  score: number;
  total: number;
  percentage: number;
  message: string;
  reviews: QuizQuestionReview[];
  topics_to_review: string[];
};

export type TutorReply = {
  reply: string;
  /** When false, hide “Make flashcards” for this assistant message. */
  allow_flashcards?: boolean;
};
