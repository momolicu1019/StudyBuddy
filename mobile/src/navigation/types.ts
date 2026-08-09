export type RootStackParamList = {
  MainTabs: undefined;
  Study: { subjectId: number };
  Quiz: { subjectId?: number };
  AITutor: { subject?: string };
  Flashcards: undefined;
  Pomodoro: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  FlashcardsTab: undefined;
  QuizTab: undefined;
  AITutorTab: undefined;
  PomodoroTab: undefined;
};
