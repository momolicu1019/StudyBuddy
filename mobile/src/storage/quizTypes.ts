import type { QuizQuestionKind } from '../api/types';

export type QuizType =
  | 'multiple_choice'
  | 'typed_answer'
  | 'true_false'
  | 'fill_blank'
  | 'mixed';

export type { QuizQuestionKind };

export type QuizTypeOption = {
  id: QuizType;
  icon: string;
  label: string;
  blurb: string;
};

export const QUIZ_TYPES: QuizTypeOption[] = [
  {
    id: 'multiple_choice',
    icon: '🧠',
    label: 'Multiple Choice',
    blurb: 'Pick the best option from four answers',
  },
  {
    id: 'typed_answer',
    icon: '✍️',
    label: 'Type the Answer',
    blurb: 'Type the answer in your own words',
  },
  {
    id: 'true_false',
    icon: '⭕',
    label: 'True / False',
    blurb: 'Decide if each statement is true or false',
  },
  {
    id: 'fill_blank',
    icon: '🔤',
    label: 'Fill in the Blank',
    blurb: 'Complete the missing word or phrase',
  },
  {
    id: 'mixed',
    icon: '🎯',
    label: 'Mixed Quiz',
    blurb: 'A mix of all question styles',
  },
];

export const QUIZ_COUNTS = [5, 10, 15, 20] as const;

export function quizTypeById(id: QuizType): QuizTypeOption {
  return QUIZ_TYPES.find((t) => t.id === id) ?? QUIZ_TYPES[0];
}

export function kindsForQuizType(type: QuizType): QuizQuestionKind[] {
  switch (type) {
    case 'multiple_choice':
      return ['multiple_choice'];
    case 'typed_answer':
      return ['typed_answer'];
    case 'true_false':
      return ['true_false'];
    case 'fill_blank':
      return ['fill_blank'];
    case 'mixed':
      return ['multiple_choice', 'typed_answer', 'true_false', 'fill_blank'];
  }
}
