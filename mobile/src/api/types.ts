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

export type Stats = {
  flashcards_reviewed: number;
  quiz_average: number;
  focus_hours: number;
};

export type GenerateResponse = {
  count: number;
  subject: Subject;
  sample_question: string;
  sample_answer: string;
  message: string;
};

export type QuizQuestion = {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
};

export type QuizResult = {
  score: number;
  total: number;
  percentage: number;
  message: string;
};

export type TutorReply = {
  reply: string;
};
